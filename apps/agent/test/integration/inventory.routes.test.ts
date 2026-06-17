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

/** Inserta un dispositivo directamente en la DB y devuelve su id. */
async function seedDevice(app: FastifyInstance, mac = 'aa:bb:cc:dd:ee:01'): Promise<string> {
  const row = await app.prisma.device.create({
    data: { mac, ip: '192.168.1.10', type: 'unknown', online: true, sources: '["arp"]' },
  });
  return row.id;
}

describe('rutas de inventario', () => {
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

  describe('PATCH /devices/:id', () => {
    it('actualiza metadatos (200)', async () => {
      const user = await seedUser(app);
      const id = await seedDevice(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/inventory/devices/${id}`,
        headers: authHeader(signAccess(app, user)),
        payload: { label: 'Impresora', type: 'printer', notes: 'oficina' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ label: 'Impresora', type: 'printer', notes: 'oficina' });
    });

    it('404 si el dispositivo no existe', async () => {
      const user = await seedUser(app);
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/inventory/devices/inexistente',
        headers: authHeader(signAccess(app, user)),
        payload: { label: 'x' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('DEVICE_NOT_FOUND');
    });

    it('400 con body vacío (minProperties) o tipo inválido', async () => {
      const user = await seedUser(app);
      const id = await seedDevice(app);
      const token = signAccess(app, user);

      const empty = await app.inject({
        method: 'PATCH',
        url: `/api/inventory/devices/${id}`,
        headers: authHeader(token),
        payload: {},
      });
      expect(empty.statusCode).toBe(400);

      const badType = await app.inject({
        method: 'PATCH',
        url: `/api/inventory/devices/${id}`,
        headers: authHeader(token),
        payload: { type: 'nave-espacial' },
      });
      expect(badType.statusCode).toBe(400);
    });

    it('401 sin token', async () => {
      const id = await seedDevice(app);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/inventory/devices/${id}`,
        payload: { label: 'x' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('block / unblock (solo admin)', () => {
    it('admin bloquea y desbloquea, y queda registrado en auditoría', async () => {
      const admin = await seedUser(app, { email: 'adm@krakenos.test', role: 'admin' });
      const id = await seedDevice(app, 'aa:bb:cc:dd:ee:02');
      const token = signAccess(app, admin);

      const blocked = await app.inject({
        method: 'POST',
        url: `/api/inventory/devices/${id}/block`,
        headers: authHeader(token),
      });
      expect(blocked.statusCode).toBe(200);
      expect(blocked.json().isBlocked).toBe(true);

      await eventually(async () => {
        const entry = await app.prisma.auditLog.findFirst({ where: { action: 'device.block' } });
        expect(entry?.userId).toBe(admin.id);
        expect(entry?.detail).toBe('aa:bb:cc:dd:ee:02');
      });

      const unblocked = await app.inject({
        method: 'DELETE',
        url: `/api/inventory/devices/${id}/block`,
        headers: authHeader(token),
      });
      expect(unblocked.statusCode).toBe(200);
      expect(unblocked.json().isBlocked).toBe(false);

      await eventually(async () => {
        const entry = await app.prisma.auditLog.findFirst({ where: { action: 'device.unblock' } });
        expect(entry).not.toBeNull();
      });
    });

    it('viewer recibe 403', async () => {
      const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
      const id = await seedDevice(app);
      const res = await app.inject({
        method: 'POST',
        url: `/api/inventory/devices/${id}/block`,
        headers: authHeader(signAccess(app, viewer)),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('AUTH_FORBIDDEN');
    });

    it('404 al bloquear un dispositivo inexistente', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/inventory/devices/inexistente/block',
        headers: authHeader(signAccess(app, admin)),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT /devices/:id/vlan', () => {
    it('asigna y quita la VLAN de un dispositivo (admin), y lo audita', async () => {
      const admin = await seedUser(app);
      const id = await seedDevice(app);

      const assigned = await app.inject({
        method: 'PUT',
        url: `/api/inventory/devices/${id}/vlan`,
        headers: authHeader(signAccess(app, admin)),
        payload: { tag: 30 },
      });
      expect(assigned.statusCode).toBe(200);
      expect(assigned.json().vlanTag).toBe(30);

      const cleared = await app.inject({
        method: 'PUT',
        url: `/api/inventory/devices/${id}/vlan`,
        headers: authHeader(signAccess(app, admin)),
        payload: { tag: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().vlanTag).toBeNull();

      await eventually(async () => {
        const entry = await app.prisma.auditLog.findFirst({ where: { action: 'device.vlan' } });
        expect(entry).not.toBeNull();
      });
    });

    it('viewer recibe 403', async () => {
      const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
      const id = await seedDevice(app);
      const res = await app.inject({
        method: 'PUT',
        url: `/api/inventory/devices/${id}/vlan`,
        headers: authHeader(signAccess(app, viewer)),
        payload: { tag: 30 },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rechaza un tag fuera de rango (400) y 404 si el dispositivo no existe', async () => {
      const admin = await seedUser(app);
      const token = signAccess(app, admin);

      const bad = await app.inject({
        method: 'PUT',
        url: `/api/inventory/devices/${await seedDevice(app)}/vlan`,
        headers: authHeader(token),
        payload: { tag: 9999 },
      });
      expect(bad.statusCode).toBe(400);

      const missing = await app.inject({
        method: 'PUT',
        url: '/api/inventory/devices/inexistente/vlan',
        headers: authHeader(token),
        payload: { tag: 30 },
      });
      expect(missing.statusCode).toBe(404);
    });
  });
});
