import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockDriver } from '../../src/drivers/mock.driver.js';
import { TrafficService } from '../../src/modules/traffic/traffic.service.js';
import { buildTestApp } from '../helpers/app.js';

describe('TrafficService', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('toma una muestra con forma válida y la guarda en el histórico', async () => {
    const svc = new TrafficService(app, new MockDriver());
    const sample = await svc.sampleOnce();

    expect(sample.rxBytesPerSec).toBeGreaterThanOrEqual(0);
    expect(sample.txBytesPerSec).toBeGreaterThanOrEqual(0);
    expect(typeof sample.timestamp).toBe('string');
    expect(svc.getHistory()).toHaveLength(1);
  });

  it('acumula muestras y limita el histórico a 60', async () => {
    const svc = new TrafficService(app, new MockDriver());
    for (let i = 0; i < 65; i++) await svc.sampleOnce();
    expect(svc.getHistory()).toHaveLength(60);
  });

  describe('rollups e histórico', () => {
    beforeEach(async () => {
      await app.prisma.trafficSample.deleteMany();
    });

    it('flushRollup persiste la media de las muestras acumuladas y resetea', async () => {
      const svc = new TrafficService(app, new MockDriver());
      await svc.sampleOnce();
      await svc.sampleOnce();
      await svc.flushRollup();

      expect(await app.prisma.trafficSample.count()).toBe(1);

      // Sin muestras nuevas, un segundo flush no crea otra fila.
      await svc.flushRollup();
      expect(await app.prisma.trafficSample.count()).toBe(1);
    });

    it('getStats agrega en buckets y estima los bytes totales', async () => {
      const svc = new TrafficService(app, new MockDriver());
      await app.prisma.trafficSample.create({ data: { rxBytesPerSec: 1000, txBytesPerSec: 500 } });
      await app.prisma.trafficSample.create({ data: { rxBytesPerSec: 3000, txBytesPerSec: 1500 } });

      const stats = await svc.getStats('day');
      expect(stats.range).toBe('day');
      expect(stats.buckets.length).toBeGreaterThanOrEqual(1);
      // Cada rollup ~60 s a su tasa media: total = Σ tasa × 60.
      expect(stats.totalRxBytes).toBe((1000 + 3000) * 60);
      expect(stats.totalTxBytes).toBe((500 + 1500) * 60);
    });

    it('getStats excluye muestras fuera de la ventana', async () => {
      const svc = new TrafficService(app, new MockDriver());
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000); // hace 2 h
      await app.prisma.trafficSample.create({
        data: { rxBytesPerSec: 1000, txBytesPerSec: 1000, timestamp: old },
      });
      await app.prisma.trafficSample.create({ data: { rxBytesPerSec: 2000, txBytesPerSec: 2000 } });

      const stats = await svc.getStats('hour'); // ventana de 1 h
      expect(stats.totalRxBytes).toBe(2000 * 60);
    });
  });

  describe('rollups por dispositivo (US-46)', () => {
    beforeEach(async () => {
      await app.prisma.deviceTrafficSample.deleteMany();
      await app.prisma.device.deleteMany();
    });

    it('flushRollup persiste un rollup por dispositivo cuando la muestra trae devices', async () => {
      const svc = new TrafficService(app, new MockDriver());
      await svc.sampleOnce();
      await svc.sampleOnce();
      await svc.flushRollup();

      // El driver mock reporta 3 MACs en cada muestra.
      expect(await app.prisma.deviceTrafficSample.count()).toBe(3);

      // Sin muestras nuevas, un segundo flush no crea más filas.
      await svc.flushRollup();
      expect(await app.prisma.deviceTrafficSample.count()).toBe(3);
    });

    it('getDeviceStats agrega por dispositivo y combina label/ip del inventario', async () => {
      const svc = new TrafficService(app, new MockDriver());
      await app.prisma.device.create({
        data: { mac: 'aa:bb:cc:00:00:01', ip: '192.168.1.5', label: 'NAS' },
      });
      await app.prisma.deviceTrafficSample.create({
        data: { mac: 'aa:bb:cc:00:00:01', rxBytesPerSec: 1000, txBytesPerSec: 500 },
      });
      await app.prisma.deviceTrafficSample.create({
        data: { mac: 'aa:bb:cc:00:00:01', rxBytesPerSec: 3000, txBytesPerSec: 1500 },
      });

      const stats = await svc.getDeviceStats('day');
      expect(stats).toHaveLength(1);
      const [first] = stats;
      expect(first?.mac).toBe('aa:bb:cc:00:00:01');
      expect(first?.label).toBe('NAS');
      expect(first?.ip).toBe('192.168.1.5');
      // Cada rollup ~60 s a su tasa media: total = Σ tasa × 60.
      expect(first?.rxTotal).toBe((1000 + 3000) * 60);
      expect(first?.txTotal).toBe((500 + 1500) * 60);
      expect((first?.samples.length ?? 0) >= 1).toBe(true);
    });
  });

  describe('histórico mensual (US-113)', () => {
    beforeEach(async () => {
      await app.prisma.trafficSample.deleteMany();
    });

    it('el rango "month" agrupa por día', async () => {
      const svc = new TrafficService(app, new MockDriver());
      const DAY = 24 * 60 * 60 * 1000;
      for (let i = 1; i <= 3; i++) {
        await app.prisma.trafficSample.create({
          data: { rxBytesPerSec: 100 * i, txBytesPerSec: 10 * i, timestamp: new Date(Date.now() - i * DAY) },
        });
      }
      const stats = await svc.getStats('month');
      expect(stats.range).toBe('month');
      expect(stats.buckets).toHaveLength(3); // un bucket por día distinto
      expect(stats.totalRxBytes).toBeGreaterThan(0);
    });
  });
});
