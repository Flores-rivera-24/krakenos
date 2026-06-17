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
});
