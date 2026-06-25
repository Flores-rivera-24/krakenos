import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';
import { FailingDriver } from '../helpers/failing-driver.js';

/**
 * Ejercita `InventoryService` contra un driver que falla. Destapa que `scan()`
 * **propaga** el error (correcto para la ruta HTTP, que responde 500) y fija que
 * `scanCycle()` —el que usan el timer periódico y el socket `inventory:rescan`—
 * lo **traga y degrada**, sin dejar una promesa rechazada que tumbe el agente.
 */
describe('InventoryService contra driver que falla', () => {
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
    it('scan() propaga el error (camino HTTP → 500)', async () => {
      const service = new InventoryService(app, new FailingDriver('throw'));
      await expect(service.scan()).rejects.toThrow(/fallo simulado/);
    });

    it('scanCycle() NO rechaza y registra el fallo (camino timer/socket)', async () => {
      const errorLog = vi.spyOn(app.log, 'error').mockImplementation(() => app.log);
      const service = new InventoryService(app, new FailingDriver('throw'));
      try {
        await expect(service.scanCycle()).resolves.toBeUndefined();
        expect(errorLog).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          expect.stringMatching(/barrido falló/i),
        );
      } finally {
        errorLog.mockRestore();
      }
    });
  });

  describe('modo timeout', () => {
    it('scanCycle() traga el timeout sin rechazar', async () => {
      const service = new InventoryService(app, new FailingDriver('timeout', { timeoutMs: 5 }));
      await expect(service.scanCycle()).resolves.toBeUndefined();
    });
  });

  describe('modo garbage — respuesta malformada del driver', () => {
    it('scan() revienta con TypeError al parsear la forma malformada', async () => {
      // GAP documentado: el servicio no valida la forma del driver; una mac
      // numérica/null hace fallar `d.mac.toLowerCase()`. Aceptable mientras el
      // ciclo de fondo lo absorba (abajo), pero la frontera del driver no está
      // endurecida → DEUDA.
      const service = new InventoryService(app, new FailingDriver('garbage'));
      await expect(service.scan()).rejects.toBeInstanceOf(TypeError);
    });

    it('scanCycle() absorbe el TypeError (no tumba el proceso)', async () => {
      const errorLog = vi.spyOn(app.log, 'error').mockImplementation(() => app.log);
      const service = new InventoryService(app, new FailingDriver('garbage'));
      try {
        await expect(service.scanCycle()).resolves.toBeUndefined();
        expect(errorLog).toHaveBeenCalled();
      } finally {
        errorLog.mockRestore();
      }
    });
  });

  describe('modo empty — degradación limpia (y nota de flapping)', () => {
    it('scan() resuelve a [] sin lanzar cuando el driver no reporta nada', async () => {
      const service = new InventoryService(app, new FailingDriver('empty'));
      await expect(service.scan()).resolves.toEqual([]);
    });

    it('un [] transitorio marca offline a los dispositivos ya conocidos (flapping)', async () => {
      // DEUDA de diseño: el servicio no distingue "red vacía" de "fallo que
      // devolvió []". Un barrido vacío por fallo transitorio marca todo offline.
      await app.prisma.device.create({
        data: {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '192.168.1.50',
          online: true,
          type: 'unknown',
          sources: '["arp"]',
        },
      });
      const service = new InventoryService(app, new FailingDriver('empty'));
      await service.scan();
      const row = await app.prisma.device.findUnique({ where: { mac: 'aa:bb:cc:dd:ee:ff' } });
      expect(row?.online).toBe(false);
    });
  });
});
