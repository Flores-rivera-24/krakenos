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

describe('rutas de VPN', () => {
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
    const res = await app.inject({ method: 'GET', url: '/api/vpn/status' });
    expect(res.statusCode).toBe(401);
  });

  it('exige rol admin (un viewer recibe 403)', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/vpn/peers',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(res.statusCode).toBe(403);
  });

  it('flujo admin: status, crear peer (201 con config+QR), listar y eliminar', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const headers = authHeader(signAccess(app, admin));

    const status = await app.inject({ method: 'GET', url: '/api/vpn/status', headers });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ enabled: true, peerCount: 0 });

    const created = await app.inject({
      method: 'POST',
      url: '/api/vpn/peers',
      headers,
      payload: { name: 'Portátil' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { peer: { id: string; name: string }; config: { config: string; qr: string } };
    expect(body.peer.name).toBe('Portátil');
    expect(body.config.config).toContain('[Interface]');
    expect(body.config.qr).toMatch(/^data:image\/png;base64,/);

    const list = await app.inject({ method: 'GET', url: '/api/vpn/peers', headers });
    expect((list.json() as unknown[]).length).toBe(1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/vpn/peers/${body.peer.id}`,
      headers,
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: '/api/vpn/peers', headers });
    expect((after.json() as unknown[]).length).toBe(0);
  });

  it('eliminar un peer inexistente devuelve 404', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/vpn/peers/nope',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(404);
  });

  it('crear un peer queda registrado en auditoría', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const headers = authHeader(signAccess(app, admin));
    await app.inject({ method: 'POST', url: '/api/vpn/peers', headers, payload: { name: 'X' } });

    await eventually(async () => {
      const entries = await app.prisma.auditLog.findMany({ where: { action: 'vpn.peer.add' } });
      expect(entries.length).toBe(1);
    });
  });
});
