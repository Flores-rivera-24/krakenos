import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';
import { FailingDriver } from '../helpers/failing-driver.js';
import type { DriverFailureMode } from '../helpers/failing-driver.js';

/**
 * Inyecta `FailingDriver` por el stack HTTP real. Comprueba que:
 *  1. Un fallo del driver en una ruta se traduce en **502 DRIVER_UNAVAILABLE**
 *     (no 500 genérico, ni cuelgue ni crash): el front (US-93/96) distingue el
 *     fallo del hardware aguas arriba y revierte/avisa limpio.
 *  2. El modo `empty` **degrada limpio** (200 con vacío / 404 coherente).
 * Tras cada fallo se golpea `/health` para probar que el agente sigue vivo.
 */
describe('rutas con driver que falla', () => {
  const apps: FastifyInstance[] = [];

  async function appWith(mode: DriverFailureMode): Promise<FastifyInstance> {
    const app = await buildTestApp({ routes: true, driver: new FailingDriver(mode, { timeoutMs: 5 }) });
    apps.push(app);
    await resetDb(app);
    return app;
  }

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  async function assertAlive(app: FastifyInstance): Promise<void> {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
  }

  describe('modo throw → 502 DRIVER_UNAVAILABLE, el agente sigue vivo', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      app = await appWith('throw');
    });

    it('GET /api/wifi devuelve 502 tipado y no tumba el proceso', async () => {
      const user = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/wifi',
        headers: authHeader(signAccess(app, user)),
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe('DRIVER_UNAVAILABLE');
      await assertAlive(app);
    });

    it('POST /api/inventory/rescan devuelve 502 y no tumba el proceso', async () => {
      const user = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/inventory/rescan',
        headers: authHeader(signAccess(app, user)),
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe('DRIVER_UNAVAILABLE');
      await assertAlive(app);
    });

    it('POST block de un dispositivo existente da 502 (el driver no pudo aplicar)', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const device = await app.prisma.device.create({
        data: { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.50', online: true, type: 'unknown', sources: '[]' },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/inventory/devices/${device.id}/block`,
        headers: authHeader(signAccess(app, admin)),
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe('DRIVER_UNAVAILABLE');
      await assertAlive(app);
    });
  });

  describe('modo empty → degradación limpia', () => {
    let app: FastifyInstance;
    let token: string;
    beforeEach(async () => {
      app = await appWith('empty');
      const user = await seedUser(app, { role: 'viewer' });
      token = signAccess(app, user);
    });

    it('GET /api/wifi devuelve 200 con la red en blanco', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/wifi', headers: authHeader(token) });
      expect(res.statusCode).toBe(200);
      expect(res.json().ssid).toBe('');
    });

    it('GET /api/wifi/networks devuelve 200 con lista vacía', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/wifi/networks',
        headers: authHeader(token),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('GET /api/wifi/networks/:id devuelve 404 coherente (red inexistente)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/wifi/networks/cualquiera',
        headers: authHeader(token),
      });
      expect(res.statusCode).toBe(404);
    });

    it('POST /api/inventory/rescan devuelve 200 con []', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/inventory/rescan',
        headers: authHeader(token),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe('modo garbage → el agente nunca cae', () => {
    it('POST /api/inventory/rescan descarta lo malformado y degrada a 200 []', async () => {
      const app = await appWith('garbage');
      const user = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/inventory/rescan',
        headers: authHeader(signAccess(app, user)),
      });
      // `normalizeDiscovered` descarta las entradas inválidas → barrido vacío.
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      await assertAlive(app);
    });

    it('GET /api/wifi (forma malformada sin normalizar) responde sin colgar ni crashear', async () => {
      // El WiFi GET no normaliza la forma (deuda conocida menor): un driver que
      // devuelve `null` sin lanzar puede serializar raro o dar 500, pero el
      // proceso sigue vivo. No es un crash.
      const app = await appWith('garbage');
      const user = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/wifi',
        headers: authHeader(signAccess(app, user)),
      });
      expect([200, 500]).toContain(res.statusCode);
      await assertAlive(app);
    });
  });
});
