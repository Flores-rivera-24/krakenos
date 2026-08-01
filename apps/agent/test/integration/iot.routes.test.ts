import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeader,
  buildTestApp,
  eventually,
  resetDb,
  seedUser,
  signAccess,
} from '../helpers/app.js';

describe('rutas de IoT', () => {
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

  it('lista dispositivos para un usuario autenticado', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/iot/devices',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBeGreaterThan(0);
  });

  it('un viewer no puede controlar (403)', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/plug-tv',
      headers: authHeader(signAccess(app, viewer)),
      payload: { on: false },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un admin enciende una luz y queda auditado', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const headers = authHeader(signAccess(app, admin));

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/light-salon',
      headers,
      payload: { brightness: 30 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ brightness: 30, on: true });

    await eventually(async () => {
      const audited = await app.prisma.auditLog.findMany({ where: { action: 'iot.device.update' } });
      expect(audited.length).toBe(1);
    });
  });

  it('controlar lo que no es controlable devuelve 400 (US-244)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    // Un sensor no se enciende — y desde US-244 tampoco un sensor de contacto ni
    // un detector de humo, que antes habrían pasado el filtro `kind === 'sensor'`.
    for (const id of ['sensor-clima', 'contact-puerta', 'smoke-cocina']) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/iot/devices/${id}`,
        headers: authHeader(signAccess(app, admin)),
        payload: { on: true },
      });
      expect(`${id} → ${res.statusCode}`).toBe(`${id} → 400`);
    }
  });

  it('una persiana y un termostato SÍ se controlan (US-244)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const persiana = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/cover-salon',
      headers: authHeader(signAccess(app, admin)),
      payload: { position: 30 },
    });
    expect(persiana.statusCode).toBe(200);
    expect(persiana.json().position).toBe(30);

    const termostato = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/climate-salon',
      headers: authHeader(signAccess(app, admin)),
      payload: { targetC: 22 },
    });
    expect(termostato.statusCode).toBe(200);
    expect(termostato.json().targetC).toBe(22);
  });

  it('mezclar campos de categorías distintas es 400 (bolsa + if/then, US-244)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/cover-salon',
      headers: authHeader(signAccess(app, admin)),
      // Una persiana no tiene brillo: el schema lo rechaza antes de llegar al manager.
      payload: { position: 30, brightness: 50 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('dispositivo inexistente devuelve 404', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/nope',
      headers: authHeader(signAccess(app, admin)),
      payload: { on: true },
    });
    expect(res.statusCode).toBe(404);
  });
});
