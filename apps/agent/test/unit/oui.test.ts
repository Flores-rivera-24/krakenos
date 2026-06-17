import { describe, expect, it } from 'vitest';
import { lookupVendor } from '../../src/modules/inventory/oui.js';

describe('lookupVendor', () => {
  it('reconoce un OUI conocido', () => {
    expect(lookupVendor('24:5a:4c:11:22:33')).toBe('Ubiquiti');
    expect(lookupVendor('f0:18:98:aa:bb:cc')).toBe('Apple');
    expect(lookupVendor('b8:27:eb:00:00:00')).toBe('Raspberry Pi');
  });

  it('normaliza separadores y mayúsculas/minúsculas', () => {
    expect(lookupVendor('24-5A-4C-11-22-33')).toBe('Ubiquiti');
    expect(lookupVendor('245a4c112233')).toBe('Ubiquiti');
    expect(lookupVendor('24:5A:4C:11:22:33')).toBe('Ubiquiti');
  });

  it('devuelve null para un OUI desconocido', () => {
    expect(lookupVendor('00:00:00:00:00:00')).toBeNull();
    expect(lookupVendor('de:ad:be:ef:00:01')).toBeNull();
  });

  it('devuelve null si la MAC es demasiado corta para tener OUI', () => {
    expect(lookupVendor('24:5a')).toBeNull();
  });
});
