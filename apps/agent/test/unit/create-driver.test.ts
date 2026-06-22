import { describe, expect, it } from 'vitest';
import {
  MikrotikDriver,
  MockDriver,
  OpenWrtDriver,
  PfSenseDriver,
  UnifiDriver,
  createDriver,
} from '../../src/drivers/index.js';

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

  it('construye un PfSenseDriver con su configuración REST', () => {
    const driver = createDriver({
      kind: 'pfsense',
      pfsense: { baseUrl: 'https://192.168.1.1', apiKey: 'KEY' },
    });
    expect(driver).toBeInstanceOf(PfSenseDriver);
    expect(driver.kind).toBe('pfsense');
  });

  it('lanza si falta la configuración pfSense, el host o la API key', () => {
    expect(() => createDriver({ kind: 'pfsense' })).toThrow(/pfSense/);
    expect(() => createDriver({ kind: 'pfsense', pfsense: { baseUrl: '', apiKey: 'K' } })).toThrow(
      /DRIVER_HOST/,
    );
    expect(() =>
      createDriver({ kind: 'pfsense', pfsense: { baseUrl: 'https://x', apiKey: '' } }),
    ).toThrow(/PFSENSE_API_KEY/);
  });

  it('construye un UnifiDriver con su configuración REST', () => {
    const driver = createDriver({
      kind: 'unifi',
      unifi: { url: 'https://192.168.1.1', username: 'admin', password: 'pw' },
    });
    expect(driver).toBeInstanceOf(UnifiDriver);
    expect(driver.kind).toBe('unifi');
  });

  it('lanza si falta la configuración UniFi, la URL o las credenciales', () => {
    expect(() => createDriver({ kind: 'unifi' })).toThrow(/UniFi/);
    expect(() =>
      createDriver({ kind: 'unifi', unifi: { url: '', username: 'a', password: 'b' } }),
    ).toThrow(/UNIFI_URL/);
    expect(() =>
      createDriver({ kind: 'unifi', unifi: { url: 'https://x', username: '', password: '' } }),
    ).toThrow(/UNIFI_USERNAME/);
  });

  it('construye un MikrotikDriver en modo rest y en modo ssh', () => {
    const rest = createDriver({
      kind: 'mikrotik',
      mikrotik: { mode: 'rest', host: '192.168.88.1', username: 'admin', password: 'pw' },
    });
    expect(rest).toBeInstanceOf(MikrotikDriver);
    expect(rest.kind).toBe('mikrotik');
    const ssh = createDriver({
      kind: 'mikrotik',
      mikrotik: { mode: 'ssh', host: '192.168.88.1', username: 'admin', password: 'pw' },
    });
    expect(ssh).toBeInstanceOf(MikrotikDriver);
  });

  it('lanza si falta la configuración MikroTik, el host o las credenciales', () => {
    expect(() => createDriver({ kind: 'mikrotik' })).toThrow(/MikroTik/);
    expect(() =>
      createDriver({ kind: 'mikrotik', mikrotik: { mode: 'rest', host: '', username: 'a', password: 'b' } }),
    ).toThrow(/MIKROTIK_HOST/);
    expect(() =>
      createDriver({ kind: 'mikrotik', mikrotik: { mode: 'rest', host: 'h', username: '', password: '' } }),
    ).toThrow(/MIKROTIK_USER/);
  });

  it('lanza para un kind desconocido', () => {
    // Forzamos un kind inválido para cubrir la rama exhaustiva.
    expect(() => createDriver({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});
