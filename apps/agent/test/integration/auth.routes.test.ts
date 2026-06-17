import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

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
});
