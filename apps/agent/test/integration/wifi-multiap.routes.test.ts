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

describe('rutas de WiFi multi-AP', () => {
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

  it('lista access points y redes (autenticado)', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const headers = authHeader(signAccess(app, user));
    const aps = await app.inject({ method: 'GET', url: '/api/wifi/access-points', headers });
    const nets = await app.inject({ method: 'GET', url: '/api/wifi/networks', headers });
    expect(aps.statusCode).toBe(200);
    expect((aps.json() as unknown[]).length).toBeGreaterThan(0);
    expect((nets.json() as unknown[]).length).toBeGreaterThan(0);
  });

  it('una red inexistente devuelve 404', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/wifi/networks/nope',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(404);
  });

  it('un viewer no puede actualizar una red (403)', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/wifi/networks/net-salon-5',
      headers: authHeader(signAccess(app, viewer)),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un admin actualiza una red y queda auditado', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const headers = authHeader(signAccess(app, admin));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/wifi/networks/net-salon-guest',
      headers,
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'net-salon-guest', enabled: true });

    await eventually(async () => {
      const audited = await app.prisma.auditLog.findMany({ where: { action: 'wifi.network.update' } });
      expect(audited.length).toBe(1);
    });
  });

  it('lista los clientes de una red y 404 si no existe', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const headers = authHeader(signAccess(app, admin));
    const ok = await app.inject({ method: 'GET', url: '/api/wifi/networks/net-salon-5/clients', headers });
    const bad = await app.inject({ method: 'GET', url: '/api/wifi/networks/nope/clients', headers });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as unknown[]).length).toBeGreaterThan(0);
    expect(bad.statusCode).toBe(404);
  });
});
