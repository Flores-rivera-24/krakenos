import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas del puente Matter (US-171)', () => {
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

  it('GET exige autenticación', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matter-bridge' });
    expect(res.statusCode).toBe(401);
  });

  it('GET devuelve el estado (desactivado por defecto) a un usuario autenticado', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/matter-bridge',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(Array.isArray(body.candidates)).toBe(true);
  });

  it('PUT exige admin (403 a un viewer)', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/matter-bridge',
      headers: authHeader(signAccess(app, viewer)),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un admin activa el puente y expone dispositivos', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/matter-bridge',
      headers: authHeader(signAccess(app, admin)),
      payload: { enabled: true, exposedDeviceIds: ['plug-tv'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.running).toBe(true);
    expect(body.endpoints.map((e: { deviceId: string }) => e.deviceId)).toContain('plug-tv');
    expect(body.qrDataUrl).toMatch(/^data:image\/png/);
  });
});
