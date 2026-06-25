import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDriver } from '../../src/drivers/mock.driver.js';
import { TrafficService } from '../../src/modules/traffic/traffic.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';
import { FailingDriver } from '../helpers/failing-driver.js';

/**
 * Ejercita `TrafficService` contra un driver que falla. El timer de muestreo
 * dispara `sampleCycle()` cada 2 s en fire-and-forget; si ahí se colara un
 * rechazo sin gestionar, sin handler global de `unhandledRejection`, el agente
 * caería. Fija que `sampleCycle()`/`flushCycle()` degradan en silencio (con log).
 */
describe('TrafficService contra driver que falla', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  describe('modo throw', () => {
    it('sampleOnce() propaga el error', async () => {
      const service = new TrafficService(app, new FailingDriver('throw'));
      await expect(service.sampleOnce()).rejects.toThrow(/fallo simulado/);
    });

    it('sampleCycle() NO rechaza y registra el fallo (camino timer)', async () => {
      const errorLog = vi.spyOn(app.log, 'error').mockImplementation(() => app.log);
      const service = new TrafficService(app, new FailingDriver('throw'));
      try {
        await expect(service.sampleCycle()).resolves.toBeUndefined();
        expect(errorLog).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          expect.stringMatching(/muestreo falló/i),
        );
      } finally {
        errorLog.mockRestore();
      }
    });

    it('un fallo de muestreo no contamina el histórico', async () => {
      const service = new TrafficService(app, new FailingDriver('throw'));
      await service.sampleCycle();
      expect(service.getHistory()).toEqual([]);
    });
  });

  describe('modo garbage — getTrafficSample malformado (frontera endurecida)', () => {
    it('sampleOnce() lanza un error descriptivo (no TypeError); sampleCycle() lo absorbe', async () => {
      const service = new TrafficService(app, new FailingDriver('garbage'));
      // `normalizeTrafficSample` detecta el wan inválido y lanza un error claro
      // en vez de dejar reventar `result.wan.rxBytesPerSec` con un TypeError.
      await expect(service.sampleOnce()).rejects.toThrow(/forma inválida/i);

      const errorLog = vi.spyOn(app.log, 'error').mockImplementation(() => app.log);
      try {
        await expect(service.sampleCycle()).resolves.toBeUndefined();
        expect(errorLog).toHaveBeenCalled();
      } finally {
        errorLog.mockRestore();
      }
    });
  });

  describe('modo empty — degradación limpia', () => {
    it('sampleOnce() registra una muestra a cero sin lanzar', async () => {
      const service = new TrafficService(app, new FailingDriver('empty'));
      const sample = await service.sampleOnce();
      expect(sample.rxBytesPerSec).toBe(0);
      expect(sample.txBytesPerSec).toBe(0);
      expect(service.getHistory()).toHaveLength(1);
    });
  });

  describe('flushCycle() — resiliencia ante fallo de persistencia', () => {
    it('absorbe un error de Prisma en el rollup sin rechazar', async () => {
      // Acumula una muestra real para que flushRollup intente persistir.
      const service = new TrafficService(app, new MockDriver());
      await service.sampleOnce();

      const createSpy = vi
        .spyOn(app.prisma.trafficSample, 'create')
        .mockRejectedValueOnce(new Error('DB caída'));
      const errorLog = vi.spyOn(app.log, 'error').mockImplementation(() => app.log);
      try {
        await expect(service.flushCycle()).resolves.toBeUndefined();
        expect(errorLog).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          expect.stringMatching(/rollup falló/i),
        );
      } finally {
        createSpy.mockRestore();
        errorLog.mockRestore();
      }
    });
  });
});
