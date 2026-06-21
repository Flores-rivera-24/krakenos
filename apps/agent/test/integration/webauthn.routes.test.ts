import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeader,
  buildTestApp,
  resetDb,
  seedUser,
  signAccess,
  signMfaPending,
} from '../helpers/app.js';

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

  it('POST /api/webauthn/authenticate/options devuelve { available: false } sin passkeys (con mfaToken válido)', async () => {
    const user = await seedUser(app, { email: 'nopk@krakenos.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/options',
      payload: { email: 'nopk@krakenos.test', mfaToken: signMfaPending(app, user.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false });
  });

  it('POST /api/webauthn/authenticate/options con passkey devuelve { available: true, options } (US-51)', async () => {
    const user = await seedUser(app, { email: 'haspk@krakenos.test' });
    await app.prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: 'cred-opt',
        publicKey: Buffer.from([1, 2, 3]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'iPhone',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/options',
      payload: { email: 'haspk@krakenos.test', mfaToken: signMfaPending(app, user.id) },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { available: boolean; options?: { challenge?: string } };
    expect(json.available).toBe(true);
    expect(typeof json.options?.challenge).toBe('string');
  });

  it('POST /api/webauthn/authenticate/options sin mfaToken → 400 (US-51)', async () => {
    await seedUser(app, { email: 'nopk2@krakenos.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/options',
      payload: { email: 'nopk2@krakenos.test' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/webauthn/authenticate/options con email inexistente → 401 (US-51)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/options',
      payload: { email: 'ghost@krakenos.test', mfaToken: signMfaPending(app, 'cualquier-id') },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_INVALID_TOKEN');
  });

  // ---- Atadura de primer y segundo factor (US-51): verify exige el mfaToken ----

  it('POST /api/webauthn/authenticate/verify sin mfaToken → 400 (US-51)', async () => {
    await seedUser(app, { email: 'v0@krakenos.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/verify',
      payload: { email: 'v0@krakenos.test', response: { id: 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/webauthn/authenticate/verify con mfaToken inválido → 401 (US-51)', async () => {
    await seedUser(app, { email: 'v1@krakenos.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/verify',
      payload: { email: 'v1@krakenos.test', mfaToken: 'no-es-un-jwt', response: { id: 'x' } },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_INVALID_TOKEN');
  });

  it('POST /api/webauthn/authenticate/verify con mfaToken expirado → 401 (US-51)', async () => {
    const user = await seedUser(app, { email: 'v2@krakenos.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/verify',
      payload: {
        email: 'v2@krakenos.test',
        mfaToken: signMfaPending(app, user.id, { expired: true }),
        response: { id: 'x' },
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_INVALID_TOKEN');
  });

  it('POST /api/webauthn/authenticate/verify con mfaToken de otro usuario → 401 (US-51)', async () => {
    const userA = await seedUser(app, { email: 'a@krakenos.test' });
    await seedUser(app, { email: 'b@krakenos.test' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/verify',
      payload: {
        // email de B pero token firmado para A → el sub no coincide.
        email: 'b@krakenos.test',
        mfaToken: signMfaPending(app, userA.id),
        response: { id: 'x' },
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_INVALID_TOKEN');
  });

  it('POST /api/webauthn/authenticate/verify con mfaToken válido pasa el gate y llega al WebAuthn (US-51)', async () => {
    const user = await seedUser(app, { email: 'v3@krakenos.test' });
    // Token válido para el usuario correcto: el gate del primer factor pasa; el
    // fallo es ahora de la ceremonia WebAuthn (sin challenge), no del token.
    const res = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/verify',
      payload: {
        email: 'v3@krakenos.test',
        mfaToken: signMfaPending(app, user.id),
        response: { id: 'x' },
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('WEBAUTHN_ERROR');
    // No se emitió ninguna sesión: el segundo factor no se superó.
    const issued = await app.prisma.refreshToken.count({ where: { userId: user.id } });
    expect(issued).toBe(0);
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
