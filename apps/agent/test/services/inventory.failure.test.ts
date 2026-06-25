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

  describe('modo garbage — respuesta malformada del driver (frontera endurecida)', () => {
    it('scan() descarta las entradas malformadas y resuelve a [] (ya no revienta)', async () => {
      const warnLog = vi.spyOn(app.log, 'warn').mockImplementation(() => app.log);
      const service = new InventoryService(app, new FailingDriver('garbage'));
      try {
        // Antes lanzaba TypeError (`d.mac.toLowerCase()`); ahora `normalizeDiscovered`
        // descarta lo inválido y avisa por el log.
        await expect(service.scan()).resolves.toEqual([]);
        expect(warnLog).toHaveBeenCalledWith(
          expect.objectContaining({ dropped: expect.any(Number) }),
          expect.stringMatching(/malformad/i),
        );
      } finally {
        warnLog.mockRestore();
      }
    });

    it('scanCycle() también degrada sin lanzar', async () => {
      const service = new InventoryService(app, new FailingDriver('garbage'));
      await expect(service.scanCycle()).resolves.toBeUndefined();
    });
  });

  describe('modo empty — degradación limpia + anti-flapping', () => {
    it('scan() resuelve a [] sin lanzar cuando el driver no reporta nada', async () => {
      const service = new InventoryService(app, new FailingDriver('empty'));
      await expect(service.scan()).resolves.toEqual([]);
    });

    it('un [] transitorio NO marca offline a los dispositivos ya conocidos (anti-flapping)', async () => {
      // Fix US-98: un barrido vacío suele ser un fallo transitorio (la red real
      // nunca está vacía: el gateway siempre aparece). No se marca offline; se avisa.
      await app.prisma.device.create({
        data: {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '192.168.1.50',
          online: true,
          type: 'unknown',
          sources: '["arp"]',
        },
      });
      const warnLog = vi.spyOn(app.log, 'warn').mockImplementation(() => app.log);
      const service = new InventoryService(app, new FailingDriver('empty'));
      try {
        await service.scan();
        const row = await app.prisma.device.findUnique({ where: { mac: 'aa:bb:cc:dd:ee:ff' } });
        expect(row?.online).toBe(true); // sigue online: no flapping
        expect(warnLog).toHaveBeenCalledWith(expect.stringMatching(/se omite el marcado offline/i));
      } finally {
        warnLog.mockRestore();
      }
    });

    it('un barrido CON dispositivos sí marca offline a los ausentes (no se rompe el caso normal)', async () => {
      // El anti-flapping solo aplica cuando el barrido está totalmente vacío.
      await app.prisma.device.create({
        data: { mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.1.51', online: true, type: 'unknown', sources: '["arp"]' },
      });
      const { MockDriver } = await import('../../src/drivers/mock.driver.js');
      const service = new InventoryService(app, new MockDriver());
      await service.scan(); // descubre 5 → el previo ausente debe quedar offline
      const row = await app.prisma.device.findUnique({ where: { mac: 'aa:bb:cc:dd:ee:01' } });
      expect(row?.online).toBe(false);
    });
  });
});
