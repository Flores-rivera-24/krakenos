import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
});
