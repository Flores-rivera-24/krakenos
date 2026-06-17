import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas de tráfico', () => {
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
    const res = await app.inject({ method: 'GET', url: '/api/traffic/history' });
    expect(res.statusCode).toBe(401);
  });

  it('devuelve el histórico (array) a un usuario autenticado', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/traffic/history',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('stats exige autenticación', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/traffic/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('devuelve estadísticas con la forma esperada (rango por defecto)', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/traffic/stats',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.range).toBe('day');
    expect(Array.isArray(body.buckets)).toBe(true);
    expect(typeof body.totalRxBytes).toBe('number');
    expect(typeof body.totalTxBytes).toBe('number');
  });

  it('rechaza un rango inválido con 400', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/traffic/stats?range=year',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(400);
  });
});
