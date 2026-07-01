import type {
  AccessPoint,
  WifiBand,
  WifiClient,
  WifiNetworkInfo,
} from '@krakenos/types';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockDriver } from '../../src/drivers/mock.driver.js';
import { auditPlugin } from '../../src/plugins/audit.js';
import { authPlugin } from '../../src/plugins/auth.js';
import { prismaPlugin } from '../../src/plugins/prisma.js';
import { coverageRoutes } from '../../src/modules/coverage/coverage.routes.js';
import { authHeader, eventually, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * Driver de pruebas con datos deterministas para cobertura. La MAC del "teléfono"
 * aparece en dos redes con distinta capitalización y distinta señal, así se puede
 * verificar el match case-insensitive y la selección del valor más fuerte (máx).
 */
const PHONE_MAC = 'AA:BB:CC:DD:EE:FF';

class FakeDriver extends MockDriver {
  override async listAccessPoints(): Promise<AccessPoint[]> {
    return [
      { id: 'ap-1', name: 'AP Salón', model: 'KrakenAP Pro', ip: '192.168.1.2', online: true, networkCount: 2 },
      { id: 'ap-2', name: 'AP Planta', model: null, ip: '192.168.1.3', online: false, networkCount: 1 },
    ];
  }

  override async listWifiNetworks(): Promise<WifiNetworkInfo[]> {
    return [
      { id: 'net-1', apId: 'ap-1', ssid: 'Kraken', band: '5GHz', security: 'wpa2', enabled: true, hidden: false, isGuest: false, clientCount: 1 },
      { id: 'net-2', apId: 'ap-1', ssid: 'Kraken', band: '2.4GHz', security: 'wpa2', enabled: true, hidden: false, isGuest: false, clientCount: 1 },
      { id: 'net-3', apId: 'ap-2', ssid: 'Kraken', band: '5GHz', security: 'wpa2', enabled: true, hidden: false, isGuest: false, clientCount: 0 },
    ];
  }

  override async listNetworkClients(id: string): Promise<WifiClient[] | null> {
    const clients: Record<string, WifiClient[]> = {
      // Misma MAC (capitalización distinta) en 5GHz (net-1: -70) y 2.4GHz
      // (net-2: -55). Un survey de 5GHz debe registrar -70 e ignorar la lectura
      // de 2.4GHz, aunque sea más fuerte (medición por banda del recorrido).
      'net-1': [{ mac: PHONE_MAC, hostname: 'phone', ip: '192.168.1.42', signalDbm: -70 }],
      'net-2': [{ mac: PHONE_MAC.toLowerCase(), hostname: 'phone', ip: '192.168.1.42', signalDbm: -55 }],
      'net-3': [],
    };
    return clients[id] ?? null;
  }
}

describe('rutas de cobertura', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // App autocontenida: los mismos plugins base que `buildTestApp` (prisma +
    // audit + auth JWT), más las rutas de cobertura registradas a mano, así el
    // test no depende de que el coordinador cablee el módulo en el helper. Se
    // registran antes de `ready()` (Fastify no admite plugins tras el arranque).
    app = Fastify({ logger: false });
    await app.register(prismaPlugin);
    await app.register(auditPlugin);
    await app.register(authPlugin);
    await app.register(coverageRoutes, { prefix: '/api/coverage', driver: new FakeDriver() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    // resetDb no toca las tablas de cobertura: limpiarlas aquí (cascada implícita).
    await app.prisma.surveySample.deleteMany();
    await app.prisma.surveyScan.deleteMany();
    await app.prisma.floorPlan.deleteMany();
  });

  const band: WifiBand = '5GHz';

  async function createPlan(adminToken: string, withAp = true): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/coverage/floorplans',
      headers: authHeader(adminToken),
      payload: {
        name: 'Planta baja',
        widthM: 10,
        heightM: 8,
        walls: [{ id: 'w1', x1: 0, y1: 0, x2: 10, y2: 0, material: 'concrete' }],
        accessPoints: withAp
          ? [{ id: 'p1', apId: 'ap-1', name: 'AP Salón', x: 5, y: 4, txPowerDbm: 20, bands: [band], enabled: true }]
          : [],
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  describe('autorización', () => {
    it('GET sin token da 401', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/coverage/floorplans' })).statusCode).toBe(401);
    });

    it('GET por viewer da 200', async () => {
      const viewer = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/coverage/floorplans',
        headers: authHeader(signAccess(app, viewer)),
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    it('POST/PATCH/DELETE por viewer dan 403', async () => {
      const viewer = await seedUser(app, { role: 'viewer' });
      const token = signAccess(app, viewer);
      const headers = authHeader(token);

      expect(
        (await app.inject({ method: 'POST', url: '/api/coverage/floorplans', headers, payload: { name: 'x', widthM: 5, heightM: 5 } })).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: 'PATCH', url: '/api/coverage/floorplans/nope', headers, payload: { name: 'y' } })).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: 'DELETE', url: '/api/coverage/floorplans/nope', headers })).statusCode,
      ).toBe(403);
    });
  });

  describe('CRUD de planos', () => {
    it('admin crea un plano (201) y audita', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const id = await createPlan(signAccess(app, admin));
      expect(id).toBeTruthy();

      const got = await app.inject({
        method: 'GET',
        url: `/api/coverage/floorplans/${id}`,
        headers: authHeader(signAccess(app, admin)),
      });
      expect(got.statusCode).toBe(200);
      expect(got.json().walls).toHaveLength(1);
      expect(got.json().accessPoints).toHaveLength(1);

      await eventually(async () => {
        const entry = await app.prisma.auditLog.findFirst({ where: { action: 'coverage.floorplan.create' } });
        expect(entry?.userId).toBe(admin.id);
      });
    });

    it('GET/PATCH/DELETE de un id inexistente dan 404', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);
      expect((await app.inject({ method: 'GET', url: '/api/coverage/floorplans/nope', headers: authHeader(token) })).statusCode).toBe(404);
      expect((await app.inject({ method: 'PATCH', url: '/api/coverage/floorplans/nope', headers: authHeader(token), payload: { name: 'z' } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: '/api/coverage/floorplans/nope', headers: authHeader(token) })).statusCode).toBe(404);
    });

    it('PATCH actualiza y DELETE borra (204)', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);
      const id = await createPlan(token);

      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/coverage/floorplans/${id}`,
        headers: authHeader(token),
        payload: { name: 'Renombrada' },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().name).toBe('Renombrada');

      const del = await app.inject({ method: 'DELETE', url: `/api/coverage/floorplans/${id}`, headers: authHeader(token) });
      expect(del.statusCode).toBe(204);
      expect((await app.inject({ method: 'GET', url: `/api/coverage/floorplans/${id}`, headers: authHeader(token) })).statusCode).toBe(404);
    });
  });

  describe('access-points', () => {
    it('agrega las bandas por AP', async () => {
      const viewer = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/coverage/access-points',
        headers: authHeader(signAccess(app, viewer)),
      });
      expect(res.statusCode).toBe(200);
      const aps = res.json() as Array<{ id: string; bands: WifiBand[]; model: string | null }>;
      const ap1 = aps.find((a) => a.id === 'ap-1');
      expect(ap1?.bands).toEqual(expect.arrayContaining(['5GHz', '2.4GHz']));
      expect(ap1?.bands).toHaveLength(2);
      const ap2 = aps.find((a) => a.id === 'ap-2');
      expect(ap2?.model).toBeNull();
      expect(ap2?.bands).toEqual(['5GHz']);
    });
  });

  describe('mapa de calor predicho', () => {
    it('devuelve una rejilla no vacía con un AP colocado', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);
      const id = await createPlan(token, true);

      const res = await app.inject({
        method: 'GET',
        url: `/api/coverage/floorplans/${id}/heatmap?band=${encodeURIComponent(band)}`,
        headers: authHeader(token),
      });
      expect(res.statusCode).toBe(200);
      const hm = res.json();
      expect(hm.source).toBe('predicted');
      expect(hm.cols * hm.rows).toBe(hm.values.length);
      expect(hm.values.length).toBeGreaterThan(0);
      // Con un AP colocado, alguna celda tiene señal.
      expect(hm.values.some((v: number | null) => v !== null)).toBe(true);
    });

    it('404 si el plano no existe', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: `/api/coverage/floorplans/nope/heatmap?band=${encodeURIComponent(band)}`,
        headers: authHeader(signAccess(app, admin)),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('surveys y medición en vivo', () => {
    it('lista/crea surveys; 404 sobre plano inexistente', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);
      const id = await createPlan(token);

      expect((await app.inject({ method: 'GET', url: '/api/coverage/floorplans/nope/scans', headers: authHeader(token) })).statusCode).toBe(404);

      const created = await app.inject({
        method: 'POST',
        url: `/api/coverage/floorplans/${id}/scans`,
        headers: authHeader(token),
        payload: { name: 'Recorrido 1', band, deviceMac: PHONE_MAC },
      });
      expect(created.statusCode).toBe(201);

      const list = await app.inject({ method: 'GET', url: `/api/coverage/floorplans/${id}/scans`, headers: authHeader(token) });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toHaveLength(1);
    });

    it('medición en vivo ENCUENTRA la MAC y guarda la muestra (found:true, señal más fuerte)', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);
      const id = await createPlan(token);
      const scan = (
        await app.inject({
          method: 'POST',
          url: `/api/coverage/floorplans/${id}/scans`,
          headers: authHeader(token),
          payload: { name: 'S', band, deviceMac: PHONE_MAC },
        })
      ).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/coverage/scans/${scan.id}/samples`,
        headers: authHeader(token),
        payload: { x: 3, y: 2 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().found).toBe(true);
      expect(res.json().rssiDbm).toBe(-70); // banda del survey (5GHz): ignora net-2 (2.4GHz, -55)
      expect(res.json().sample).not.toBeNull();

      const detail = await app.inject({ method: 'GET', url: `/api/coverage/scans/${scan.id}`, headers: authHeader(token) });
      expect(detail.json().samples).toHaveLength(1);
    });

    it('medición en vivo NO encuentra la MAC (found:false, sin muestra)', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);
      const id = await createPlan(token);
      const scan = (
        await app.inject({
          method: 'POST',
          url: `/api/coverage/floorplans/${id}/scans`,
          headers: authHeader(token),
          payload: { name: 'S', band, deviceMac: '11:22:33:44:55:66' },
        })
      ).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/coverage/scans/${scan.id}/samples`,
        headers: authHeader(token),
        payload: { x: 1, y: 1 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().found).toBe(false);
      expect(res.json().rssiDbm).toBeNull();
      expect(res.json().sample).toBeNull();

      const detail = await app.inject({ method: 'GET', url: `/api/coverage/scans/${scan.id}`, headers: authHeader(token) });
      expect(detail.json().samples).toHaveLength(0);
    });

    it('muestra manual (con rssiDbm) sobre survey sin deviceMac', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);
      const id = await createPlan(token);
      const scan = (
        await app.inject({
          method: 'POST',
          url: `/api/coverage/floorplans/${id}/scans`,
          headers: authHeader(token),
          payload: { name: 'Manual', band },
        })
      ).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/coverage/scans/${scan.id}/samples`,
        headers: authHeader(token),
        payload: { x: 2, y: 2, rssiDbm: -42 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().found).toBe(true);
      expect(res.json().rssiDbm).toBe(-42);
    });

    it('400 si la muestra no trae rssiDbm y el survey no tiene deviceMac', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);
      const id = await createPlan(token);
      const scan = (
        await app.inject({
          method: 'POST',
          url: `/api/coverage/floorplans/${id}/scans`,
          headers: authHeader(token),
          payload: { name: 'Manual', band },
        })
      ).json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/coverage/scans/${scan.id}/samples`,
        headers: authHeader(token),
        payload: { x: 2, y: 2 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('404 al registrar muestra o leer detalle de un survey inexistente', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);
      expect((await app.inject({ method: 'GET', url: '/api/coverage/scans/nope', headers: authHeader(token) })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'POST', url: '/api/coverage/scans/nope/samples', headers: authHeader(token), payload: { x: 0, y: 0, rssiDbm: -50 } })).statusCode,
      ).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: '/api/coverage/scans/nope', headers: authHeader(token) })).statusCode).toBe(404);
    });

    it('mapa de calor medido de un survey con muestras', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const token = signAccess(app, admin);
      const id = await createPlan(token);
      const scan = (
        await app.inject({
          method: 'POST',
          url: `/api/coverage/floorplans/${id}/scans`,
          headers: authHeader(token),
          payload: { name: 'Medido', band },
        })
      ).json();
      await app.inject({
        method: 'POST',
        url: `/api/coverage/scans/${scan.id}/samples`,
        headers: authHeader(token),
        payload: { x: 2, y: 2, rssiDbm: -45 },
      });

      const res = await app.inject({ method: 'GET', url: `/api/coverage/scans/${scan.id}/heatmap`, headers: authHeader(token) });
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toBe('measured');
      expect(res.json().cols * res.json().rows).toBe(res.json().values.length);
    });
  });
});
