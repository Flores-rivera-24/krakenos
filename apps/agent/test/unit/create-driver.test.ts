import { describe, expect, it } from 'vitest';
import { MockDriver } from '../../src/drivers/mock.driver.js';
import { createDriver } from '../../src/drivers/index.js';

describe('createDriver', () => {
  it('devuelve un MockDriver para kind "mock"', () => {
    const driver = createDriver({ kind: 'mock' });
    expect(driver).toBeInstanceOf(MockDriver);
    expect(driver.kind).toBe('mock');
  });

  it('lanza para drivers aún no implementados', () => {
    expect(() => createDriver({ kind: 'openwrt' })).toThrow(/OpenWrt/);
    expect(() => createDriver({ kind: 'pfsense' })).toThrow(/pfSense/);
  });

  it('lanza para un kind desconocido', () => {
    // Forzamos un kind inválido para cubrir la rama exhaustiva.
    expect(() => createDriver({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});
