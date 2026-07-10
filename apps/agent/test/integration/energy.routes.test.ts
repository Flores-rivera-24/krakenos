import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas de energía (US-182)', () => {
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

  it('stats exige autenticación', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/energy/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('devuelve estadísticas con la forma esperada (rango por defecto)', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/energy/stats',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.range).toBe('day');
    expect(Array.isArray(body.buckets)).toBe(true);
    expect(typeof body.totalEnergyWh).toBe('number');
    expect(typeof body.previousTotalEnergyWh).toBe('number');
    expect(body.currency).toBe('€');
    expect(body.pricePerKwh).toBeNull();
    expect(Array.isArray(body.devices)).toBe(true);
  });

  it('rechaza un rango inválido con 400', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/energy/stats?range=hour',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /config lo lee cualquier autenticado; devuelve valores por defecto', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/energy/config',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pricePerKwh: null, currency: '€' });
  });

  it('PUT /config exige admin (403 a un viewer)', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/energy/config',
      headers: authHeader(signAccess(app, viewer)),
      payload: { pricePerKwh: 0.2 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un admin fija el precio y la moneda, y el stats los refleja', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/energy/config',
      headers: authHeader(signAccess(app, admin)),
      payload: { pricePerKwh: 0.25, currency: '$' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ pricePerKwh: 0.25, currency: '$' });

    const stats = await app.inject({
      method: 'GET',
      url: '/api/energy/stats',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(stats.json().pricePerKwh).toBe(0.25);
    expect(stats.json().currency).toBe('$');
  });

  it('un precio negativo se rechaza con 400 (schema)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/energy/config',
      headers: authHeader(signAccess(app, admin)),
      payload: { pricePerKwh: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('pricePerKwh null limpia el precio', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    await app.inject({
      method: 'PUT',
      url: '/api/energy/config',
      headers: authHeader(signAccess(app, admin)),
      payload: { pricePerKwh: 0.3 },
    });
    const clear = await app.inject({
      method: 'PUT',
      url: '/api/energy/config',
      headers: authHeader(signAccess(app, admin)),
      payload: { pricePerKwh: null },
    });
    expect(clear.json().pricePerKwh).toBeNull();
  });

  it('exporta CSV de energía (US-182)', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    await app.prisma.energySample.create({ data: { deviceId: 'plug-tv', powerW: 120 } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/energy.csv?range=day',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('dispositivo');
  });
});
