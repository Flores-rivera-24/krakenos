import { describe, expect, it } from 'vitest';
import { MockDriver, OpenWrtDriver, createDriver } from '../../src/drivers/index.js';

const OPENWRT = {
  wanInterface: 'wan',
  ssh: { host: '192.168.1.1', username: 'root', password: 'x' },
} as const;

describe('createDriver', () => {
  it('devuelve un MockDriver para kind "mock"', () => {
    const driver = createDriver({ kind: 'mock' });
    expect(driver).toBeInstanceOf(MockDriver);
    expect(driver.kind).toBe('mock');
  });

  it('construye un OpenWrtDriver con su configuración SSH', () => {
    const driver = createDriver({ kind: 'openwrt', host: '192.168.1.1', openwrt: OPENWRT });
    expect(driver).toBeInstanceOf(OpenWrtDriver);
    expect(driver.kind).toBe('openwrt');
  });

  it('lanza si falta la configuración OpenWrt o el host SSH', () => {
    expect(() => createDriver({ kind: 'openwrt' })).toThrow(/OpenWrt/);
    expect(() =>
      createDriver({ kind: 'openwrt', openwrt: { ...OPENWRT, ssh: { ...OPENWRT.ssh, host: '' } } }),
    ).toThrow(/DRIVER_HOST/);
  });

  it('lanza para el driver pfSense (pendiente)', () => {
    expect(() => createDriver({ kind: 'pfsense' })).toThrow(/pfSense/);
  });

  it('lanza para un kind desconocido', () => {
    // Forzamos un kind inválido para cubrir la rama exhaustiva.
    expect(() => createDriver({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});
