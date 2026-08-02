import { describe, expect, it } from 'vitest';
import {
  AsusDriver,
  MikrotikDriver,
  MockDriver,
  OmadaDriver,
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

  it('construye un OmadaDriver con su configuración REST', () => {
    const driver = createDriver({
      kind: 'omada',
      omada: { url: 'https://192.168.1.10:8043', username: 'admin', password: 'pw' },
    });
    expect(driver).toBeInstanceOf(OmadaDriver);
    expect(driver.kind).toBe('omada');
  });

  it('lanza si falta la configuración Omada, la URL o las credenciales', () => {
    expect(() => createDriver({ kind: 'omada' })).toThrow(/Omada/);
    expect(() =>
      createDriver({ kind: 'omada', omada: { url: '', username: 'a', password: 'b' } }),
    ).toThrow(/OMADA_URL/);
    expect(() =>
      createDriver({ kind: 'omada', omada: { url: 'https://x', username: '', password: '' } }),
    ).toThrow(/OMADA_USERNAME/);
  });

  it('construye un AsusDriver con su configuración', () => {
    const driver = createDriver({
      kind: 'asus',
      asus: { host: '192.168.1.1', username: 'admin', password: 'pw' },
    });
    expect(driver).toBeInstanceOf(AsusDriver);
    expect(driver.kind).toBe('asus');
  });

  it('lanza si falta la configuración ASUS, el host o las credenciales', () => {
    expect(() => createDriver({ kind: 'asus' })).toThrow(/ASUS/);
    expect(() =>
      createDriver({ kind: 'asus', asus: { host: '', username: 'a', password: 'b' } }),
    ).toThrow(/ASUS_HOST/);
    expect(() =>
      createDriver({ kind: 'asus', asus: { host: 'h', username: '', password: '' } }),
    ).toThrow(/ASUS_USERNAME/);
  });

  it('lanza para un kind desconocido', () => {
    // Forzamos un kind inválido para cubrir la rama exhaustiva.
    expect(() => createDriver({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});

/**
 * US-238 — quien tenía `DRIVER_KIND=cisco-ios` en su `.env` se encuentra el
 * agente sin arrancar al actualizar. El fallback a `.env` de `tryBuild` **no** le
 * cubre (el valor retirado está justo en el `.env`), así que lo único que le
 * queda es el mensaje: tiene que decir qué pasó y qué teclear.
 */
describe('kinds retirados (US-238)', () => {
  it('explica qué pasó, propone alternativas y no cae a mock — SIN dar un código interno', () => {
    // ⚠️ Este test exigía antes que el mensaje **nombrara la historia** («US-238»),
    // y eso cambió a propósito el 2026-08-02: quien se encuentra este error no
    // tiene forma de resolver ese código —no hay tracker público—, así que era
    // ruido en el único texto que le queda para saber qué teclear. El motivo sí es
    // accionable y se sigue exigiendo abajo.
    for (const kind of ['cisco-ios', 'cisco-netconf'] as const) {
      let mensaje = '';
      try {
        createDriver({ kind } as never);
      } catch (err) {
        mensaje = err instanceof Error ? err.message : String(err);
      }
      expect(mensaje).toContain(kind);
      expect(mensaje).not.toMatch(/\bUS-\d{2,3}\b/);
      expect(mensaje).toMatch(/se retiró/i);
      expect(mensaje).toContain('openwrt');
      // Lo que impide el arreglo tentador: degradar a mock enseñaría una casa
      // inventada. Si alguien lo "arregla" así, este test lo caza.
      expect(mensaje).toMatch(/mock/i);
    }
  });

  it('un kind desconocido cualquiera sigue fallando, sin mensaje inventado', () => {
    expect(() => createDriver({ kind: 'inexistente' } as never)).toThrow(/Driver desconocido/);
  });
});
