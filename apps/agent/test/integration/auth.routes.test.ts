import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, eventually, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Hace login por HTTP y devuelve los tokens. */
async function login(app: FastifyInstance, email: string, password: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  return { status: res.statusCode, body: res.json() as { tokens: { accessToken: string; refreshToken: string } } };
}

describe('rutas de autenticación', () => {
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

  it('flujo completo: login → status → refresh → logout', async () => {
    const user = await seedUser(app, { email: 'flujo@krakenos.test', password: 'password123' });
    const { status, body } = await login(app, 'flujo@krakenos.test', 'password123');
    expect(status).toBe(200);

    // status con el access token recién emitido
    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      headers: authHeader(body.tokens.accessToken),
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().id).toBe(user.id);

    // refresh rota el token
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: body.tokens.refreshToken },
    });
    expect(refreshRes.statusCode).toBe(200);
    const rotated = refreshRes.json() as { refreshToken: string };
    expect(rotated.refreshToken).not.toBe(body.tokens.refreshToken);

    // el refresh viejo ya no sirve (401)
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: body.tokens.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);

    // logout revoca el refresh nuevo (204) e impide refrescarlo
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(logoutRes.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('GET /api/auth/last-session devuelve null si no hay logins (US-49)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/last-session' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('GET /api/auth/last-session devuelve { timestamp, ip } tras un login (US-49)', async () => {
    await seedUser(app, { email: 'last@krakenos.test', password: 'password123' });
    const ok = await login(app, 'last@krakenos.test', 'password123');
    expect(ok.status).toBe(200);

    // El audit log se escribe sin await (best-effort) → reintentar.
    const body = await eventually(async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/last-session' });
      expect(res.statusCode).toBe(200);
      const json = res.json() as { timestamp: string; ip: string } | null;
      if (!json) throw new Error('aún sin sesión registrada');
      return json;
    });
    expect(typeof body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(typeof body.ip).toBe('string');
    // No debe exponer datos del usuario.
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('userId');
  });

  it('login de usuario sin passkeys sigue emitiendo tokens (US-50)', async () => {
    await seedUser(app, { email: 'nopk@krakenos.test', password: 'password123' });
    const { status, body } = await login(app, 'nopk@krakenos.test', 'password123');
    expect(status).toBe(200);
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.tokens.refreshToken).toBeTruthy();
  });

  it('login de usuario con passkeys devuelve { requiresWebAuthn } sin tokens (US-50)', async () => {
    const user = await seedUser(app, { email: 'pk@krakenos.test', password: 'password123' });
    await app.prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: 'cred-xyz',
        publicKey: Buffer.from([9, 9, 9]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'YubiKey',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'pk@krakenos.test', password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as {
      requiresWebAuthn?: boolean;
      email?: string;
      mfaToken?: string;
      tokens?: unknown;
    };
    expect(json.requiresWebAuthn).toBe(true);
    expect(json.email).toBe('pk@krakenos.test');
    expect(json.tokens).toBeUndefined();
    // US-51: emite un token efímero `mfa-pending` que ata la contraseña al paso WebAuthn.
    expect(typeof json.mfaToken).toBe('string');
    expect(json.mfaToken!.length).toBeGreaterThan(0);

    // No se debe haber emitido ningún refresh token todavía.
    const issued = await app.prisma.refreshToken.count({ where: { userId: user.id } });
    expect(issued).toBe(0);
  });

  it('el token mfa-pending no sirve como access token (US-51)', async () => {
    const user = await seedUser(app, { email: 'mfa@krakenos.test', password: 'password123' });
    await app.prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: 'cred-mfa',
        publicKey: Buffer.from([7, 7, 7]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'YubiKey',
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'mfa@krakenos.test', password: 'password123' },
    });
    const { mfaToken } = login.json() as { mfaToken: string };

    // Usar el mfaToken como Bearer en una ruta autenticada → rechazado.
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      headers: authHeader(mfaToken),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_INVALID_TOKEN');
  });

  it('rechaza un refresh token usado como access (Bearer)', async () => {
    const refreshLike = app.jwt.sign({ sub: 'x', type: 'refresh', jti: 'abc' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      headers: authHeader(refreshLike),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_INVALID_TOKEN');
  });

  it('rechaza un Bearer mal formado', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      headers: { authorization: 'Bearer no-es-un-jwt' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_UNAUTHORIZED');
  });

  it('status devuelve 401 si el usuario del token ya no existe', async () => {
    const user = await seedUser(app, { email: 'borrado@krakenos.test' });
    const token = signAccess(app, user);
    await app.prisma.user.delete({ where: { id: user.id } });

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_UNAUTHORIZED');
  });

  // ---- Sesiones (US-41) ----

  async function loginOk(app: FastifyInstance, email: string, password: string) {
    const { body } = await login(app, email, password);
    return body.tokens;
  }

  it('GET /api/auth/sessions lista solo las sesiones activas del usuario', async () => {
    await seedUser(app, { email: 's@krakenos.test', password: 'password123' });
    const a = await loginOk(app, 's@krakenos.test', 'password123');
    await loginOk(app, 's@krakenos.test', 'password123'); // segunda sesión

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: authHeader(a.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('DELETE /api/auth/sessions/:id revoca esa sesión', async () => {
    await seedUser(app, { email: 's2@krakenos.test', password: 'password123' });
    const a = await loginOk(app, 's2@krakenos.test', 'password123');
    const list = (
      await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: authHeader(a.accessToken) })
    ).json() as { id: string }[];

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${list[0]!.id}`,
      headers: authHeader(a.accessToken),
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: authHeader(a.accessToken),
    });
    expect(after.json()).toHaveLength(0);
  });

  it('DELETE /api/auth/sessions revoca todas menos la actual', async () => {
    await seedUser(app, { email: 's3@krakenos.test', password: 'password123' });
    const a = await loginOk(app, 's3@krakenos.test', 'password123');
    await loginOk(app, 's3@krakenos.test', 'password123');
    await loginOk(app, 's3@krakenos.test', 'password123'); // 3 sesiones

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/auth/sessions',
      headers: authHeader(a.accessToken),
      payload: { keepRefreshToken: a.refreshToken },
    });
    expect(del.statusCode).toBe(204);

    const after = (
      await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: authHeader(a.accessToken) })
    ).json() as unknown[];
    expect(after).toHaveLength(1); // solo la actual sobrevive
  });
});
