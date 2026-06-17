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
});
