import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas de sistema', () => {
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

  it('GET /api/system/stats exige autenticación (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/system/stats devuelve estadísticas con forma válida', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/stats',
      headers: authHeader(signAccess(app, user)),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.cpu.cores).toBeGreaterThanOrEqual(1);
    expect(body.cpu.loadPercent).toBeGreaterThanOrEqual(0);
    expect(body.cpu.loadPercent).toBeLessThanOrEqual(100);
    expect(body.memory.totalBytes).toBeGreaterThan(0);
    expect(body.memory.usedBytes).toBeGreaterThanOrEqual(0);
    expect(body.memory.usedPercent).toBeGreaterThanOrEqual(0);
    expect(body.memory.usedPercent).toBeLessThanOrEqual(100);
    expect(typeof body.timestamp).toBe('string');
  });

  it('GET /api/system/settings devuelve ajustes (con defaults) + info', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settings.scanIntervalSec).toBe('60'); // default
    expect(body.info.driver).toBe('mock');
    expect(typeof body.info.httpsEnabled).toBe('boolean');
  });

  it('PATCH /api/system/settings persiste y devuelve la setting actualizada (admin)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, admin)),
      payload: { key: 'timezone', value: 'Europe/Madrid' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.timezone).toBe('Europe/Madrid');
  });

  it('PATCH /api/system/settings rechaza claves fuera de la allowlist (400)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, admin)),
      payload: { key: 'passwordHash', value: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /api/system/settings requiere rol admin (403 a viewer)', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, viewer)),
      payload: { key: 'timezone', value: 'UTC' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/system/connectivity-test devuelve ok con el driver mock (admin)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/connectivity-test',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.latencyMs).toBe('number');
  });
});
