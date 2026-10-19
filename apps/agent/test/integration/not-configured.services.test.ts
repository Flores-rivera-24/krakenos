import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoneDriver } from '../../src/drivers/none.driver.js';
import { NoneIotManager } from '../../src/iot/none.iot.js';
import { AccessScheduleService } from '../../src/modules/access/access.service.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { IotIdMigrationService } from '../../src/modules/iot/id-migration.service.js';
import { TrafficService } from '../../src/modules/traffic/traffic.service.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * Los barridos de fondo no sondean lo que no existe: ni llaman al driver, ni registran un
 * error por ciclo, ni marcan como caído lo que se conocía, ni dan por hecho lo que no han
 * podido hacer. Un `NoneDriver` que CUENTA las llamadas es el observador: sin él, un barrido
 * que llamara y recibiera `[]` pasaría igual y el test no probaría la omisión.
 */
class CountingNoneDriver extends NoneDriver {
  calls = 0;
  override async scanArp() {
    this.calls++;
    return super.scanArp();
  }
  override async scanMdns() {
    this.calls++;
    return super.scanMdns();
  }
  override async getTrafficSample(): ReturnType<NoneDriver['getTrafficSample']> {
    this.calls++;
    return super.getTrafficSample();
  }
  override async blockDevice(mac: string) {
    this.calls++;
    return super.blockDevice(mac);
  }
  override async unblockDevice(mac: string) {
    this.calls++;
    return super.unblockDevice(mac);
  }
}

describe('barridos con el router sin configurar', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: false });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    vi.restoreAllMocks();
  });

  describe('inventario', () => {
    it('no llama al driver y NO marca como caído lo que ya se conocía', async () => {
      const driver = new CountingNoneDriver();
      const service = new InventoryService(app, driver);
      await app.prisma.device.create({
        data: { mac: 'aa:bb:cc:00:00:01', ip: '192.168.1.9', online: true, sources: '["arp"]' },
      });
      const warn = vi.spyOn(app.log, 'warn');

      const list = await service.scan();

      expect(driver.calls).toBe(0);
      expect(list).toHaveLength(1);
      expect(list[0]!.online).toBe(true); // sigue como estaba: no hay información, no «se ha ido»
      expect(warn).not.toHaveBeenCalled(); // ni el «barrido sin dispositivos» de cada ciclo
    });

    it('no emite ningún aviso de aparato desconocido (no hay aparatos que descubrir)', async () => {
      const driver = new CountingNoneDriver();
      const eventos: unknown[] = [];
      const service = new InventoryService(app, driver);
      service.setEventSink((e) => eventos.push(e));
      const audit = vi.spyOn(app, 'audit');

      await service.scan();

      expect(eventos).toEqual([]);
      expect(audit.mock.calls.filter((c) => /unknown_device/.test(c[0].action))).toEqual([]);
      expect(await app.prisma.device.count()).toBe(0);
    });
  });

  describe('tráfico', () => {
    it('el muestreo no llama al driver, no deja muestras a 0 B/s y no registra un error por ciclo', async () => {
      const driver = new CountingNoneDriver();
      const service = new TrafficService(app, driver);
      const error = vi.spyOn(app.log, 'error');

      await service.sampleCycle();
      await service.sampleCycle();

      expect(driver.calls).toBe(0);
      expect(service.getHistory()).toEqual([]);
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe('horarios de acceso y pausas', () => {
    const horario = (mac: string) =>
      app.prisma.accessSchedule.create({
        data: {
          name: 'Noche',
          mac,
          enabled: true,
          days: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
          startMinute: 0,
          endMinute: 1439,
        },
      });

    it('no reintenta bloquear contra un driver que no existe: un aviso, no un error por barrido', async () => {
      const driver = new CountingNoneDriver();
      const service = new AccessScheduleService(app, driver);
      await horario('aa:bb:cc:00:00:01');
      await horario('aa:bb:cc:00:00:02');
      const warn = vi.spyOn(app.log, 'warn');
      const error = vi.spyOn(app.log, 'error');

      for (let i = 0; i < 5; i++) await service.tick(new Date('2026-01-05T12:00:00Z'));

      expect(driver.calls).toBe(0);
      expect(error).not.toHaveBeenCalled();
      // Un solo aviso para los cinco barridos, y dice cuántos horarios no se aplican.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain('2 horario(s)');
    });

    it('sin ningún horario definido no avisa de nada', async () => {
      const service = new AccessScheduleService(app, new CountingNoneDriver());
      const warn = vi.spyOn(app.log, 'warn');
      await service.tick(new Date());
      expect(warn).not.toHaveBeenCalled();
    });

    it('reanudar no necesita router: limpia la pausa y no llama al driver', async () => {
      const driver = new CountingNoneDriver();
      const service = new AccessScheduleService(app, driver);
      const mac = 'aa:bb:cc:00:00:03';
      await app.prisma.device.create({
        data: {
          mac,
          ip: '192.168.1.3',
          online: true,
          sources: '["arp"]',
          pausedUntil: new Date(Date.now() + 60_000),
        },
      });
      await expect(service.resume(mac)).resolves.toEqual({ applied: true });
      expect(driver.calls).toBe(0);
      expect((await app.prisma.device.findUnique({ where: { mac } }))?.pausedUntil).toBeNull();
    });
  });

  describe('migración de ids IoT', () => {
    it('contra un IoT sin configurar NO se da por hecha: se migrará cuando haya backend', async () => {
      // Sin esto, los ids crudos de las escenas quedaban «sin resolver» y la marca de
      // idempotencia impedía migrarlos nunca, aunque luego se conectara Hue.
      await app.prisma.scene.create({
        data: { name: 'Cine', actions: JSON.stringify([{ deviceId: 'foco-1', on: true }]) },
      });
      const service = new IotIdMigrationService({
        app,
        iot: new NoneIotManager(),
        kinds: [],
      });

      await expect(service.run()).resolves.toBeNull();

      expect(
        await app.prisma.setting.findUnique({ where: { key: 'iot.idsPrefixed.v1' } }),
      ).toBeNull();
      const scene = await app.prisma.scene.findFirst();
      expect(JSON.parse(scene!.actions)).toEqual([{ deviceId: 'foco-1', on: true }]);
    });
  });
});

describe('sistema con el router sin configurar', () => {
  let app: FastifyInstance;
  let admin: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true, driver: new CountingNoneDriver() });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = signAccess(app, await seedUser(app, { email: 'admin@krakenos.test', role: 'admin' }));
  });

  it('/metrics no mide la latencia de un router que no existe (no hay un driver:none en rojo)', async () => {
    const driver = new CountingNoneDriver();
    const local = await buildTestApp({ routes: true, driver });
    const token = signAccess(local, await seedUser(local, { email: 'm@krakenos.test' }));
    const healthcheck = vi.spyOn(driver, 'healthcheck');
    const res = await local.inject({
      method: 'GET',
      url: '/api/system/metrics',
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    expect(healthcheck).not.toHaveBeenCalled();
    await local.close();
  });

  it('el test de conectividad dice que no hay router, no «el driver no respondió»', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/connectivity-test',
      headers: authHeader(admin),
    });
    expect(res.json()).toEqual({ ok: false, error: 'No hay ningún router conectado todavía' });
  });
});
