import type { HomeEvent, IotDevice, IotManager } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { EnergyAlertService } from '../../src/modules/energy/energy-alerts.service.js';
import { buildTestApp } from '../helpers/app.js';

/** IoT mínimo con potencia controlable por el test. */
class StubIot implements IotManager {
  constructor(private power: number) {}
  setPower(p: number) {
    this.power = p;
  }
  async listDevices(): Promise<IotDevice[]> {
    return [
      {
        id: 'plug-x',
        name: 'Enchufe',
        kind: 'plug',
        room: null,
        reachable: true,
        on: true,
        brightness: null,
        color: null,
        reading: null,
        powerW: this.power,
      },
    ];
  }
  async getDevice(id: string): Promise<IotDevice | null> {
    return (await this.listDevices()).find((d) => d.id === id) ?? null;
  }
  async setState(): Promise<IotDevice> {
    throw new Error('no usado');
  }
}

function at(min: number): Date {
  return new Date(2026, 6, 10, 0, min, 0, 0);
}

describe('EnergyAlertService (US-183)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.prisma.energyAlertRule.deleteMany();
    await app.prisma.energySample.deleteMany();
    await app.prisma.auditLog.deleteMany();
  });

  it('CRUD de reglas', async () => {
    const svc = new EnergyAlertService(app, new StubIot(0), new HomeEventBus());
    const created = await svc.create({ deviceId: 'plug-x', metric: 'sustained-power', threshold: 500 });
    expect(created.sustainMinutes).toBe(5);
    expect((await svc.list())).toHaveLength(1);

    const updated = await svc.update(created.id, { threshold: 800, enabled: false });
    expect(updated?.threshold).toBe(800);
    expect(updated?.enabled).toBe(false);

    expect(await svc.remove(created.id)).toBe(true);
    expect(await svc.list()).toHaveLength(0);
    expect(await svc.update('nope', { threshold: 1 })).toBeNull();
    expect(await svc.remove('nope')).toBe(false);
  });

  it('dispara al sostenerse la potencia: publica evento al bus y audita', async () => {
    const events: HomeEvent[] = [];
    const bus = new HomeEventBus();
    bus.subscribe((e) => void events.push(e));
    const iot = new StubIot(600);
    const svc = new EnergyAlertService(app, iot, bus);
    await svc.create({ deviceId: 'plug-x', metric: 'sustained-power', threshold: 500, sustainMinutes: 5 });

    await svc.tick(at(0)); // arranca el sostenido, aún no dispara
    expect(events).toHaveLength(0);
    await svc.tick(at(5)); // 5 min sostenido → dispara

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'energy-threshold', deviceId: 'plug-x', metric: 'sustained-power' });
    // Audita como `energy.threshold` (despacho multicanal US-180).
    await vi.waitFor(async () => {
      const audit = await app.prisma.auditLog.findFirst({ where: { action: 'energy.threshold' } });
      expect(audit).not.toBeNull();
    });
  });

  it('no dispara si el dispositivo no reporta potencia', async () => {
    const events: HomeEvent[] = [];
    const bus = new HomeEventBus();
    bus.subscribe((e) => void events.push(e));
    // powerW = null: el StubIot con NaN no; usamos un IoT sin powerW.
    const iot: IotManager = {
      listDevices: async () => [
        {
          id: 'plug-x',
          name: 'x',
          kind: 'plug',
          room: null,
          reachable: true,
          on: true,
          brightness: null,
          color: null,
          reading: null,
          powerW: null,
        },
      ],
      getDevice: async () => null,
      setState: async () => {
        throw new Error('no');
      },
    };
    const svc = new EnergyAlertService(app, iot, bus);
    await svc.create({ deviceId: 'plug-x', metric: 'sustained-power', threshold: 100, sustainMinutes: 1 });
    await svc.tick(at(0));
    await svc.tick(at(5));
    expect(events).toHaveLength(0);
  });

  it('dispara por energía diaria acumulada', async () => {
    const events: HomeEvent[] = [];
    const bus = new HomeEventBus();
    bus.subscribe((e) => void events.push(e));
    const svc = new EnergyAlertService(app, new StubIot(0), bus);
    await svc.create({ deviceId: 'plug-x', metric: 'daily-energy', threshold: 100 });

    // 200 filas de 60 W en el día → 200 × 60 × (60/3600) = 200 Wh > 100.
    const today = new Date(2026, 6, 10, 8, 0, 0);
    for (let i = 0; i < 200; i++) {
      await app.prisma.energySample.create({
        data: { deviceId: 'plug-x', powerW: 60, timestamp: today },
      });
    }
    await svc.tick(new Date(2026, 6, 10, 9, 0, 0));
    expect(events.some((e) => e.type === 'energy-threshold' && e.metric === 'daily-energy')).toBe(true);
  });

  it('una regla deshabilitada no se evalúa', async () => {
    const events: HomeEvent[] = [];
    const bus = new HomeEventBus();
    bus.subscribe((e) => void events.push(e));
    const svc = new EnergyAlertService(app, new StubIot(9999), bus);
    await svc.create({
      deviceId: 'plug-x',
      metric: 'sustained-power',
      threshold: 100,
      sustainMinutes: 1,
      enabled: false,
    });
    await svc.tick(at(0));
    await svc.tick(at(5));
    expect(events).toHaveLength(0);
  });
});
