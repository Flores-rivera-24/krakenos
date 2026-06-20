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

  it('GET /api/traffic/devices devuelve el desglose por dispositivo (US-46)', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    await app.prisma.device.create({
      data: { mac: 'aa:bb:cc:00:00:09', ip: '192.168.1.9', label: 'TV' },
    });
    await app.prisma.deviceTrafficSample.create({
      data: { mac: 'aa:bb:cc:00:00:09', rxBytesPerSec: 2000, txBytesPerSec: 1000 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/traffic/devices?range=hour',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].mac).toBe('aa:bb:cc:00:00:09');
    expect(body[0].label).toBe('TV');
    expect(body[0].rxTotal).toBeGreaterThan(0);
  });
});
