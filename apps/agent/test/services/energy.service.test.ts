import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import { EnergyService } from '../../src/modules/energy/energy.service.js';
import { buildTestApp } from '../helpers/app.js';

describe('EnergyService (US-181)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.prisma.energySample.deleteMany();
    await app.prisma.setting.deleteMany({ where: { key: 'energyPricePerKwh' } });
  });

  it('muestrea solo los dispositivos que reportan potencia', async () => {
    const iot = new MockIotManager();
    const svc = new EnergyService(app, iot);
    await svc.sampleOnce();
    await svc.flushRollup();

    const rows = await app.prisma.energySample.findMany();
    const devices = await iot.listDevices();
    // Los que tienen powerW numérico (enchufes/luces con carga), no los sensores.
    const withPower = devices.filter((d) => typeof d.powerW === 'number');
    expect(rows).toHaveLength(withPower.length);
    // Ningún sensor (powerW null) genera fila.
    const sensorIds = devices.filter((d) => d.kind === 'sensor').map((d) => d.id);
    expect(rows.some((r) => sensorIds.includes(r.deviceId))).toBe(false);
  });

  it('flushRollup persiste la media de las muestras y resetea el acumulador', async () => {
    const iot = new MockIotManager();
    const svc = new EnergyService(app, iot);
    await svc.sampleOnce();
    await svc.sampleOnce();
    await svc.flushRollup();

    const first = await app.prisma.energySample.count();
    expect(first).toBeGreaterThan(0);

    // Sin muestras nuevas, un segundo flush no crea filas.
    await svc.flushRollup();
    expect(await app.prisma.energySample.count()).toBe(first);
  });

  it('un dispositivo apagado consume ~0 y no rompe la agregación', async () => {
    const iot = new MockIotManager();
    // La cafetera nace apagada en el mock → powerW 0.
    const svc = new EnergyService(app, iot);
    await svc.sampleOnce();
    await svc.flushRollup();

    const cafetera = await app.prisma.energySample.findFirst({
      where: { deviceId: 'plug-cafetera' },
    });
    expect(cafetera?.powerW).toBe(0);
  });

  it('getStats integra la energía (Wh) de la potencia media persistida', async () => {
    const iot = new MockIotManager();
    const svc = new EnergyService(app, iot);
    // Dos rollups de 100 W: cada uno representa 1 min → 100 W × (60/3600) h = 1.667 Wh.
    await app.prisma.energySample.create({ data: { deviceId: 'plug-x', powerW: 100 } });
    await app.prisma.energySample.create({ data: { deviceId: 'plug-x', powerW: 100 } });

    const stats = await svc.getStats('day');
    expect(stats.range).toBe('day');
    // 2 × (100 × 60/3600) = 3.333 Wh
    expect(stats.totalEnergyWh).toBeCloseTo(2 * (100 / 60), 2);
    expect(stats.devices).toHaveLength(1);
    expect(stats.devices[0]?.deviceId).toBe('plug-x');
    expect(stats.devices[0]?.energyWh).toBeCloseTo(2 * (100 / 60), 2);
  });

  it('getStats calcula el coste cuando hay precio del kWh configurado', async () => {
    const iot = new MockIotManager();
    const svc = new EnergyService(app, iot);
    await app.prisma.setting.create({ data: { key: 'energyPricePerKwh', value: '0.15' } });
    // 1000 Wh = 1 kWh → coste = 1 × 0.15 = 0.15. Necesitamos 1 kWh: potencia sostenida.
    // 1 fila de 60000 W durante 1 min = 60000 × 60/3600 = 1000 Wh = 1 kWh.
    await app.prisma.energySample.create({ data: { deviceId: 'plug-x', powerW: 60000 } });

    const stats = await svc.getStats('day');
    expect(stats.pricePerKwh).toBe(0.15);
    expect(stats.totalEnergyWh).toBeCloseTo(1000, 1);
    expect(stats.totalCost).toBeCloseTo(0.15, 2);
    expect(stats.devices[0]?.cost).toBeCloseTo(0.15, 2);
  });

  it('sin precio configurado, el coste es null', async () => {
    const iot = new MockIotManager();
    const svc = new EnergyService(app, iot);
    await app.prisma.energySample.create({ data: { deviceId: 'plug-x', powerW: 100 } });

    const stats = await svc.getStats('day');
    expect(stats.pricePerKwh).toBeNull();
    expect(stats.totalCost).toBeNull();
    expect(stats.devices[0]?.cost).toBeNull();
  });

  it('un precio no numérico o negativo se ignora (coste null)', async () => {
    const iot = new MockIotManager();
    const svc = new EnergyService(app, iot);
    await app.prisma.setting.create({ data: { key: 'energyPricePerKwh', value: '-1' } });
    await app.prisma.energySample.create({ data: { deviceId: 'plug-x', powerW: 100 } });

    const stats = await svc.getStats('day');
    expect(stats.pricePerKwh).toBeNull();
  });

  it('getStats combina nombre/estancia del manager vivo', async () => {
    const iot = new MockIotManager();
    const svc = new EnergyService(app, iot);
    await app.prisma.energySample.create({ data: { deviceId: 'plug-tv', powerW: 120 } });

    const stats = await svc.getStats('day');
    const tv = stats.devices.find((d) => d.deviceId === 'plug-tv');
    expect(tv?.name).toBe('TV');
    expect(tv?.room).toBe('Salón');
  });

  it('un id que ya no está en el manager conserva sus datos con nombre null', async () => {
    const iot = new MockIotManager();
    const svc = new EnergyService(app, iot);
    await app.prisma.energySample.create({ data: { deviceId: 'ghost:1', powerW: 50 } });

    const stats = await svc.getStats('day');
    const ghost = stats.devices.find((d) => d.deviceId === 'ghost:1');
    expect(ghost?.name).toBeNull();
    expect(ghost?.energyWh).toBeGreaterThan(0);
  });

  it('getStats excluye muestras fuera de la ventana', async () => {
    const iot = new MockIotManager();
    const svc = new EnergyService(app, iot);
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // hace 40 días
    await app.prisma.energySample.create({
      data: { deviceId: 'plug-x', powerW: 100, timestamp: old },
    });
    await app.prisma.energySample.create({ data: { deviceId: 'plug-x', powerW: 200 } });

    const stats = await svc.getStats('week'); // ventana de 7 días
    // Solo la muestra reciente cuenta.
    expect(stats.devices).toHaveLength(1);
    expect(stats.devices[0]?.buckets.length).toBe(1);
  });

  it('el rango "month" agrupa por día', async () => {
    const iot = new MockIotManager();
    const svc = new EnergyService(app, iot);
    const DAY = 24 * 60 * 60 * 1000;
    for (let i = 1; i <= 3; i++) {
      await app.prisma.energySample.create({
        data: { deviceId: 'plug-x', powerW: 100 * i, timestamp: new Date(Date.now() - i * DAY) },
      });
    }
    const stats = await svc.getStats('month');
    expect(stats.range).toBe('month');
    expect(stats.buckets).toHaveLength(3); // un bucket por día distinto
  });
});
