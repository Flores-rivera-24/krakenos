import { describe, expect, it } from 'vitest';
import { DriverUnavailableError } from '../../src/drivers/driver-error.js';
import {
  normalizeAccessPoints,
  normalizeGuestNetwork,
  normalizeWifiClientsOrNull,
  normalizeWifiNetwork,
  normalizeWifiNetworkOrNull,
  normalizeWifiNetworks,
} from '../../src/modules/wifi/normalize.js';

const VALID_WIFI = {
  ssid: 'KrakenOS',
  enabled: true,
  band: '5GHz',
  security: 'wpa2/wpa3',
  hidden: false,
  updatedAt: '2026-06-25T00:00:00.000Z',
};

const VALID_NET = {
  id: 'net-1',
  apId: 'ap-1',
  ssid: 'KrakenOS',
  band: '5GHz',
  security: 'wpa2/wpa3',
  enabled: true,
  hidden: false,
  isGuest: false,
  clientCount: 3,
};

describe('normalizeWifiNetwork (singleton, US-98)', () => {
  it('conserva una red válida', () => {
    expect(normalizeWifiNetwork(VALID_WIFI)).toEqual(VALID_WIFI);
  });

  it('lanza 502 DRIVER_UNAVAILABLE si es null/no objeto', () => {
    expect(() => normalizeWifiNetwork(null)).toThrow(DriverUnavailableError);
    expect(() => normalizeWifiNetwork('x')).toThrow(DriverUnavailableError);
  });

  it('lanza si falta un campo o el band no es del enum', () => {
    expect(() => normalizeWifiNetwork({ ...VALID_WIFI, enabled: undefined })).toThrow(
      DriverUnavailableError,
    );
    expect(() => normalizeWifiNetwork({ ...VALID_WIFI, band: 'marte' })).toThrow(
      DriverUnavailableError,
    );
  });

  it('el error lleva statusCode 502', () => {
    try {
      normalizeWifiNetwork(null);
      throw new Error('debería lanzar');
    } catch (err) {
      expect((err as DriverUnavailableError).statusCode).toBe(502);
      expect((err as DriverUnavailableError).code).toBe('DRIVER_UNAVAILABLE');
    }
  });
});

describe('normalizeGuestNetwork (US-98)', () => {
  it('acepta bandwidthLimitMbps null', () => {
    const guest = {
      ssid: 'Invitados',
      enabled: false,
      clientIsolation: true,
      bandwidthLimitMbps: null,
      updatedAt: '2026-06-25T00:00:00.000Z',
    };
    expect(normalizeGuestNetwork(guest)).toEqual(guest);
  });

  it('lanza si clientIsolation no es booleano', () => {
    expect(() =>
      normalizeGuestNetwork({
        ssid: 'x',
        enabled: false,
        clientIsolation: 'sí',
        bandwidthLimitMbps: 10,
        updatedAt: '2026-06-25T00:00:00.000Z',
      }),
    ).toThrow(DriverUnavailableError);
  });
});

describe('listas WiFi (US-98)', () => {
  it('normalizeAccessPoints descarta entradas inválidas y conserva las válidas', () => {
    const aps = normalizeAccessPoints([
      { id: 'ap-1', name: 'Salón', model: null, ip: '192.168.1.2', online: true, networkCount: 2 },
      null,
      { id: 'ap-2', name: 'Planta', ip: '192.168.1.3', online: true, networkCount: 'dos' }, // bad
    ]);
    expect(aps).toHaveLength(1);
    expect(aps[0]?.id).toBe('ap-1');
  });

  it('normalizeWifiNetworks descarta inválidas', () => {
    const nets = normalizeWifiNetworks([VALID_NET, { id: 'x' }, 42]);
    expect(nets).toHaveLength(1);
  });

  it('una lista que no es array → 502', () => {
    expect(() => normalizeAccessPoints('no-array')).toThrow(DriverUnavailableError);
    expect(() => normalizeWifiNetworks({})).toThrow(DriverUnavailableError);
  });
});

describe('getters nullable (US-98)', () => {
  it('normalizeWifiNetworkOrNull: null pasa (→ 404 en la ruta)', () => {
    expect(normalizeWifiNetworkOrNull(null)).toBeNull();
    expect(normalizeWifiNetworkOrNull(undefined)).toBeNull();
  });

  it('normalizeWifiNetworkOrNull: objeto válido pasa, objeto inválido → 502', () => {
    expect(normalizeWifiNetworkOrNull(VALID_NET)).toEqual(VALID_NET);
    expect(() => normalizeWifiNetworkOrNull({ id: 'x' })).toThrow(DriverUnavailableError);
  });

  it('normalizeWifiClientsOrNull: null pasa; array se sanea; no-array → 502', () => {
    expect(normalizeWifiClientsOrNull(null)).toBeNull();
    expect(
      normalizeWifiClientsOrNull([
        { mac: 'aa:bb:cc:dd:ee:ff', hostname: 'pc', ip: '192.168.1.5', signalDbm: -50 },
        { mac: '', ip: 'x', signalDbm: -50 }, // mac vacía → fuera
      ]),
    ).toEqual([{ mac: 'aa:bb:cc:dd:ee:ff', hostname: 'pc', ip: '192.168.1.5', signalDbm: -50 }]);
    expect(() => normalizeWifiClientsOrNull('x')).toThrow(DriverUnavailableError);
  });
});
