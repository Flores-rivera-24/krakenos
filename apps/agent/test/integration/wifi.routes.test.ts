import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, eventually, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas WiFi', () => {
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

  describe('red principal', () => {
    it('GET requiere autenticación', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/wifi' })).statusCode).toBe(401);
    });

    it('GET no expone la contraseña', async () => {
      const user = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/wifi',
        headers: authHeader(signAccess(app, user)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('password');
      expect(res.json()).toHaveProperty('ssid');
    });

    it('PUT por admin actualiza y audita; nunca devuelve la contraseña', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/wifi',
        headers: authHeader(signAccess(app, admin)),
        payload: { ssid: 'CasaNueva', password: 'unaclavesegura', band: '2.4GHz' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ssid).toBe('CasaNueva');
      expect(res.json().band).toBe('2.4GHz');
      expect(res.json()).not.toHaveProperty('password');

      await eventually(async () => {
        const entry = await app.prisma.auditLog.findFirst({ where: { action: 'wifi.update' } });
        expect(entry?.userId).toBe(admin.id);
      });
    });

    it('PUT por viewer da 403', async () => {
      const viewer = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/wifi',
        headers: authHeader(signAccess(app, viewer)),
        payload: { ssid: 'NoDeberia' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('400 con body vacío o banda inválida', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);

      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/api/wifi',
            headers: authHeader(token),
            payload: {},
          })
        ).statusCode,
      ).toBe(400);

      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/api/wifi',
            headers: authHeader(token),
            payload: { band: '7GHz' },
          })
        ).statusCode,
      ).toBe(400);
    });
  });

  describe('red de invitados', () => {
    it('GET devuelve la red de invitados sin contraseña', async () => {
      const user = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/wifi/guest',
        headers: authHeader(signAccess(app, user)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('clientIsolation');
      expect(res.json()).not.toHaveProperty('password');
    });

    it('PUT por admin habilita la red y audita', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/wifi/guest',
        headers: authHeader(signAccess(app, admin)),
        payload: { enabled: true, bandwidthLimitMbps: 20 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().enabled).toBe(true);
      expect(res.json().bandwidthLimitMbps).toBe(20);

      await eventually(async () => {
        const entry = await app.prisma.auditLog.findFirst({
          where: { action: 'wifi.guest.update' },
        });
        expect(entry?.userId).toBe(admin.id);
      });
    });

    it('PUT por viewer da 403', async () => {
      const viewer = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/wifi/guest',
        headers: authHeader(signAccess(app, viewer)),
        payload: { enabled: true },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
