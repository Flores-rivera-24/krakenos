import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas de cámaras', () => {
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

  it('exige autenticación', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cameras' });
    expect(res.statusCode).toBe(401);
  });

  it('lista cámaras a un usuario autenticado', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/cameras',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBeGreaterThan(0);
  });

  it('devuelve un snapshot de una cámara online', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/cameras/cam-entrada/snapshot',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { image: string }).image).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('una cámara offline o inexistente devuelve 404', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const headers = authHeader(signAccess(app, user));
    const offline = await app.inject({ method: 'GET', url: '/api/cameras/cam-garaje/snapshot', headers });
    const unknown = await app.inject({ method: 'GET', url: '/api/cameras/nope/snapshot', headers });
    expect(offline.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
  });
});
