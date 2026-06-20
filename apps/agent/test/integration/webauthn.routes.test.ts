import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas WebAuthn', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  it('POST /api/webauthn/authenticate/options devuelve { available: false } sin passkeys', async () => {
    await seedUser(app, { email: 'nopk@krakenos.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/options',
      payload: { email: 'nopk@krakenos.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false });
  });

  it('POST /api/webauthn/authenticate/options devuelve { available: false } si el usuario no existe', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/options',
      payload: { email: 'ghost@krakenos.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false });
  });

  it('POST /api/webauthn/register/options requiere autenticación (401 sin token)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/webauthn/register/options' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/webauthn/credentials devuelve lista vacía para usuario nuevo', async () => {
    const user = await seedUser(app, { email: 'fresh@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/webauthn/credentials',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('DELETE /api/webauthn/credentials/:id devuelve 404 para credencial inexistente', async () => {
    const user = await seedUser(app, { email: 'del@krakenos.test' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/webauthn/credentials/no-existe',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/webauthn/credentials lista las passkeys del usuario (sin clave pública)', async () => {
    const user = await seedUser(app, { email: 'has@krakenos.test' });
    await app.prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: 'cred-abc',
        publicKey: Buffer.from([1, 2, 3]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'iPhone',
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/webauthn/credentials',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]!.name).toBe('iPhone');
    expect(body[0]).not.toHaveProperty('publicKey');
    expect(body[0]).not.toHaveProperty('counter');
  });
});
