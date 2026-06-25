import { describe, expect, it } from 'vitest';
import { FailingDriver } from '../helpers/failing-driver.js';

/**
 * Verifica que el propio fixture de inyección de fallos se comporta según cada
 * modo. (Si el fixture miente, los tests que lo usan no prueban nada.)
 */
describe('FailingDriver (fixture de inyección de fallos)', () => {
  it('cumple el contrato: kind "mock"', () => {
    expect(new FailingDriver('throw').kind).toBe('mock');
  });

  describe('modo throw — toda operación rechaza', () => {
    const d = new FailingDriver('throw');
    it('scanArp rechaza', async () => {
      await expect(d.scanArp()).rejects.toThrow(/fallo simulado/);
    });
    it('getTrafficSample rechaza', async () => {
      await expect(d.getTrafficSample()).rejects.toThrow(/fallo simulado/);
    });
    it('blockDevice rechaza', async () => {
      await expect(d.blockDevice('aa:bb:cc:dd:ee:ff')).rejects.toThrow();
    });
    it('getWifi rechaza', async () => {
      await expect(d.getWifi()).rejects.toThrow();
    });
  });

  describe('modo timeout — rechaza tras un retardo', () => {
    it('scanArp rechaza con error de timeout', async () => {
      const d = new FailingDriver('timeout', { timeoutMs: 5 });
      await expect(d.scanArp()).rejects.toThrow(/ETIMEDOUT/);
    });
  });

  describe('modo empty — vacíos válidos', () => {
    const d = new FailingDriver('empty');
    it('scanArp/scanMdns devuelven []', async () => {
      expect(await d.scanArp()).toEqual([]);
      expect(await d.scanMdns()).toEqual([]);
    });
    it('getTrafficSample devuelve WAN a cero y devices []', async () => {
      const s = await d.getTrafficSample();
      expect(s.wan).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 });
      expect(s.devices).toEqual([]);
    });
    it('listas multi-AP vacías y getWifiNetwork null', async () => {
      expect(await d.listAccessPoints()).toEqual([]);
      expect(await d.listWifiNetworks()).toEqual([]);
      expect(await d.getWifiNetwork()).toBeNull();
      expect(await d.listNetworkClients()).toBeNull();
    });
    it('block/unblock resuelven sin lanzar', async () => {
      await expect(d.blockDevice('aa:bb:cc:dd:ee:ff')).resolves.toBeUndefined();
      await expect(d.unblockDevice('aa:bb:cc:dd:ee:ff')).resolves.toBeUndefined();
    });
  });

  describe('modo garbage — formas malformadas', () => {
    const d = new FailingDriver('garbage');
    it('scanArp resuelve con entradas inválidas (mac numérica, null)', async () => {
      const arp = (await d.scanArp()) as unknown[];
      expect(Array.isArray(arp)).toBe(true);
      expect(arp).toContain(null);
    });
    it('getTrafficSample resuelve con wan null', async () => {
      const s = (await d.getTrafficSample()) as unknown as { wan: unknown };
      expect(s.wan).toBeNull();
    });
    it('getWifi resuelve con null', async () => {
      expect(await d.getWifi()).toBeNull();
    });
  });
});
