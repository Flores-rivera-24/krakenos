import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PER_DEVICE_TRAFFIC_BY_KIND,
  reportsPerDeviceTraffic,
} from '../../src/drivers/capabilities.js';
import { INTEGRATION_SCHEMA } from '../../src/integrations/schema.js';

const srcDir = fileURLToPath(new URL('../../src/drivers/', import.meta.url));

/** Fichero del driver de cada kind (el mock incluido). */
function driverSource(kind: string): string {
  return readFileSync(`${srcDir}${kind}.driver.ts`, 'utf8');
}

describe('capacidad «tráfico por dispositivo» (US-263)', () => {
  it('declara TODOS los kinds del catálogo de integraciones', () => {
    const delCatalogo = Object.keys(INTEGRATION_SCHEMA.driver).sort();
    const declarados = Object.keys(PER_DEVICE_TRAFFIC_BY_KIND).sort();
    // Si esto falla es que se añadió un driver sin decidir si reporta el desglose.
    expect(declarados).toEqual(delCatalogo);
  });

  it('hoy SOLO el mock lo reporta: en producción el bienestar digital está vacío', () => {
    const conDesglose = Object.entries(PER_DEVICE_TRAFFIC_BY_KIND)
      .filter(([, v]) => v)
      .map(([k]) => k);
    expect(conDesglose).toEqual(['mock']);
    expect(reportsPerDeviceTraffic('openwrt')).toBe(false);
    expect(reportsPerDeviceTraffic('mock')).toBe(true);
  });

  /**
   * El guard que de verdad protege: lo DECLARADO debe coincidir con lo que el
   * driver hace. Un driver que declara `false` tiene que devolver literalmente
   * `devices: []`; el día que alguien implemente el desglose (US-251), ese literal
   * desaparecerá y este test le obligará a actualizar el mapa — que es justo lo
   * que hace que la UI deje de mentir.
   */
  it('cada driver sin desglose devuelve `devices: []` de verdad en su código', () => {
    for (const [kind, reporta] of Object.entries(PER_DEVICE_TRAFFIC_BY_KIND)) {
      if (reporta) continue;
      const src = driverSource(kind);
      expect(src, `${kind}.driver.ts declara NO reportar pero no devuelve devices: []`)
        .toMatch(/devices:\s*\[\]/);
    }
  });

  it('el mock, que sí declara reportarlo, NO devuelve un array vacío', () => {
    expect(driverSource('mock')).not.toMatch(/devices:\s*\[\]/);
  });
});
