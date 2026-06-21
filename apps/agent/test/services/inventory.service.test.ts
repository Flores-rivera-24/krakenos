import type { Device } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockDriver } from '../../src/drivers/mock.driver.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

function byMac(devices: Device[], mac: string): Device {
  const found = devices.find((d) => d.mac === mac);
  if (!found) throw new Error(`Dispositivo ${mac} no encontrado`);
  return found;
}

describe('InventoryService', () => {
  let app: FastifyInstance;
  let driver: MockDriver;
  let service: InventoryService;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    driver = new MockDriver();
    service = new InventoryService(app, driver);
  });

  describe('scan', () => {
    it('fusiona ARP + mDNS por MAC y persiste un dispositivo por MAC única', async () => {
      const devices = await service.scan();
      // 4 MACs por ARP + 1 extra solo-mDNS (chromecast) = 5.
      expect(devices).toHaveLength(5);
    });

    it('resuelve fabricante por OUI y une orígenes (arp + mdns)', async () => {
      const devices = await service.scan();
      const gateway = byMac(devices, '24:5a:4c:11:22:33');

      expect(gateway.vendor).toBe('Ubiquiti');
      expect(gateway.hostname).toBe('gateway');
      expect(gateway.online).toBe(true);
      expect([...gateway.sources].sort()).toEqual(['arp', 'mdns']);
    });

    it('infiere el tipo a partir de hostname y fabricante', async () => {
      const devices = await service.scan();

      expect(byMac(devices, '24:5a:4c:11:22:33').type).toBe('router'); // hostname "gateway"
      expect(byMac(devices, 'f0:18:98:aa:bb:cc').type).toBe('computer'); // vendor Apple
      expect(byMac(devices, '24:0a:c4:de:ad:01').type).toBe('iot'); // vendor Espressif
      expect(byMac(devices, 'dc:a6:32:de:ad:02').type).toBe('computer'); // vendor Raspberry Pi
      expect(byMac(devices, 'd8:3a:dd:00:cc:01').type).toBe('tv'); // hostname "chromecast-tv"
    });

    it('un dispositivo visto solo por mDNS tiene únicamente ese origen', async () => {
      const devices = await service.scan();
      const chromecast = byMac(devices, 'd8:3a:dd:00:cc:01');
      expect([...chromecast.sources]).toEqual(['mdns']);
    });

    it('marca offline lo que no apareció en el barrido', async () => {
      await app.prisma.device.create({
        data: {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '192.168.1.200',
          online: true,
          type: 'unknown',
          sources: '["arp"]',
        },
      });

      const devices = await service.scan();
      const stale = byMac(devices, 'aa:bb:cc:dd:ee:ff');
      expect(stale.online).toBe(false);
    });

    it('marca offline en una sola escritura (updateMany), no N updates (US-54)', async () => {
      // Varios dispositivos previos que no aparecerán en el barrido del mock.
      const staleMacs = ['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02', 'aa:bb:cc:dd:ee:03'];
      for (const [i, mac] of staleMacs.entries()) {
        await app.prisma.device.create({
          data: { mac, ip: `192.168.1.${200 + i}`, online: true, type: 'unknown', sources: '["arp"]' },
        });
      }

      // Cuenta las escrituras sobre Device durante el barrido vía middleware de
      // Prisma (espiar el delegate de Prisma no es fiable: rompe el call-through).
      const writes: string[] = [];
      let counting = true;
      app.prisma.$use(async (params, next) => {
        if (
          counting &&
          params.model === 'Device' &&
          (params.action === 'update' || params.action === 'updateMany')
        ) {
          writes.push(params.action);
        }
        return next(params);
      });

      try {
        const devices = await service.scan();

        // Una sola escritura (updateMany) para todos los stale, ningún update por dispositivo.
        expect(writes).toEqual(['updateMany']);
        for (const mac of staleMacs) {
          expect(byMac(devices, mac).online).toBe(false);
        }
      } finally {
        counting = false;
      }
    });

    it('respeta el tipo fijado por el usuario en barridos posteriores', async () => {
      await service.scan();
      // El usuario reclasifica el MacBook (vendor Apple) como 'tablet'.
      const list = await service.list();
      const macbook = byMac(list, 'f0:18:98:aa:bb:cc');
      await service.updateMetadata(macbook.id, { type: 'tablet' });

      // Un nuevo barrido no debe pisar la elección del usuario.
      const after = await service.scan();
      expect(byMac(after, 'f0:18:98:aa:bb:cc').type).toBe('tablet');
    });

    it('es idempotente: re-escanear no duplica dispositivos', async () => {
      await service.scan();
      const second = await service.scan();
      expect(second).toHaveLength(5);
    });
  });

  describe('updateMetadata', () => {
    it('actualiza label, type y notes y emite el evento', async () => {
      const emit = vi.spyOn(app.io, 'emit');
      const [device] = await service.scan();
      if (!device) throw new Error('sin dispositivos');

      const updated = await service.updateMetadata(device.id, {
        label: 'Mi router',
        type: 'router',
        notes: 'gabinete',
      });

      expect(updated?.label).toBe('Mi router');
      expect(updated?.type).toBe('router');
      expect(updated?.notes).toBe('gabinete');
      expect(emit).toHaveBeenCalledWith('inventory:device-updated', expect.objectContaining({
        id: device.id,
      }));
    });

    it('devuelve null si el dispositivo no existe', async () => {
      expect(await service.updateMetadata('inexistente', { label: 'x' })).toBeNull();
    });
  });

  describe('setBlocked', () => {
    it('bloquea vía driver y persiste isBlocked', async () => {
      const block = vi.spyOn(driver, 'blockDevice');
      const [device] = await service.scan();
      if (!device) throw new Error('sin dispositivos');

      const blocked = await service.setBlocked(device.id, true);
      expect(blocked?.isBlocked).toBe(true);
      expect(block).toHaveBeenCalledWith(device.mac);
    });

    it('desbloquea vía driver', async () => {
      const unblock = vi.spyOn(driver, 'unblockDevice');
      const [device] = await service.scan();
      if (!device) throw new Error('sin dispositivos');
      await service.setBlocked(device.id, true);

      const unblocked = await service.setBlocked(device.id, false);
      expect(unblocked?.isBlocked).toBe(false);
      expect(unblock).toHaveBeenCalledWith(device.mac);
    });

    it('devuelve null y no toca el driver si el dispositivo no existe', async () => {
      const block = vi.spyOn(driver, 'blockDevice');
      expect(await service.setBlocked('inexistente', true)).toBeNull();
      expect(block).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('devuelve los dispositivos ordenados por lastSeen descendente', async () => {
      await service.scan();
      const list = await service.list();
      const times = list.map((d) => Date.parse(d.lastSeen));
      const sorted = [...times].sort((a, b) => b - a);
      expect(times).toEqual(sorted);
    });
  });
});
