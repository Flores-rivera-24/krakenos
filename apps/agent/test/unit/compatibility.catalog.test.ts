import { describe, expect, it } from 'vitest';
import { buildCompatibilityCatalog } from '../../src/modules/compatibility/compatibility.catalog.js';
import { INTEGRATION_SCHEMA } from '../../src/integrations/schema.js';

describe('buildCompatibilityCatalog (US-208)', () => {
  const catalog = buildCompatibilityCatalog();
  const byId = (id: string) => catalog.find((e) => e.id === id);

  it('deriva del catálogo de integraciones (no es una lista a mano)', () => {
    // OpenWrt y Pi-hole están en el schema → aparecen.
    expect(byId('driver:openwrt')?.label).toBe(INTEGRATION_SCHEMA.driver.openwrt!.label);
    expect(byId('dns:pihole')).toBeTruthy();
    expect(byId('iot:hue')).toBeTruthy();
  });

  it('excluye el modo demostración (mock/zeroConfig)', () => {
    expect(catalog.some((e) => e.id.endsWith(':mock'))).toBe(false);
    expect(byId('iot:tuya')).toBeTruthy(); // tuya no es zeroConfig aunque no tenga campos
  });

  it('asigna capacidades por categoría; el driver suma WiFi si lo soporta', () => {
    const openwrt = byId('driver:openwrt');
    expect(openwrt?.capabilities).toEqual(expect.arrayContaining(['inventory', 'block', 'traffic', 'wifi']));
    // pfSense no gestiona WiFi (wifiSupported ausente).
    const pfsense = byId('driver:pfsense');
    expect(pfsense?.capabilities).not.toContain('wifi');

    expect(byId('dns:pihole')?.capabilities).toEqual(['dns-block']);
    expect(byId('iot:hue')?.capabilities).toEqual(['control']);
  });

  it('deriva requisitos de los campos + deps opcionales', () => {
    // Hue: URL del bridge (address) + appKey secreto (credentials).
    expect(byId('iot:hue')?.requirements).toEqual(expect.arrayContaining(['address', 'credentials']));
    // OpenWrt: host + contraseña + dep node-ssh.
    expect(byId('driver:openwrt')?.requirements).toEqual(
      expect.arrayContaining(['address', 'credentials', 'extra-dependency']),
    );
  });

  it('nada está verificado con hardware real todavía (US-86)', () => {
    expect(catalog.every((e) => e.verified === false)).toBe(true);
  });

  it('ordena por nombre y no está vacío', () => {
    expect(catalog.length).toBeGreaterThan(5);
    const labels = catalog.map((e) => e.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });
});
