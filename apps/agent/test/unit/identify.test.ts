import { describe, expect, it } from 'vitest';
import { inferDeviceType } from '../../src/modules/inventory/identify.js';

describe('inferDeviceType', () => {
  it('infiere por hostname', () => {
    expect(inferDeviceType(null, 'home-gateway')).toBe('router');
    expect(inferDeviceType(null, 'Erics-iPhone')).toBe('phone');
    expect(inferDeviceType(null, 'work-ipad')).toBe('tablet');
    expect(inferDeviceType(null, 'living-room-chromecast')).toBe('tv');
    expect(inferDeviceType(null, 'epson-printer')).toBe('printer');
  });

  it('infiere por fabricante cuando el hostname no aporta', () => {
    expect(inferDeviceType('Ubiquiti', null)).toBe('router');
    expect(inferDeviceType('Espressif', null)).toBe('iot');
    expect(inferDeviceType('Google', null)).toBe('iot');
    expect(inferDeviceType('Amazon', null)).toBe('iot');
    expect(inferDeviceType('Raspberry Pi', null)).toBe('computer');
    expect(inferDeviceType('Apple', null)).toBe('computer');
    expect(inferDeviceType('Intel', null)).toBe('computer');
  });

  it('da prioridad al hostname sobre el fabricante', () => {
    // 'tv' en el hostname gana aunque el fabricante sugiera otra cosa.
    expect(inferDeviceType('Apple', 'apple-tv')).toBe('tv');
    // 'gateway' gana sobre el vendor Apple → computer.
    expect(inferDeviceType('Apple', 'gateway')).toBe('router');
  });

  it('es insensible a mayúsculas', () => {
    expect(inferDeviceType('UBIQUITI', null)).toBe('router');
    expect(inferDeviceType(null, 'MY-IPHONE')).toBe('phone');
  });

  it('cae en "unknown" cuando no hay señales', () => {
    expect(inferDeviceType(null, null)).toBe('unknown');
    expect(inferDeviceType('FabricanteRaro', 'host-cualquiera')).toBe('unknown');
  });
});
