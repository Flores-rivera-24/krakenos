import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PER_DEVICE_TRAFFIC_BY_KIND,
  declaredCapability,
  reportsPerDeviceTraffic,
  resolvePerDeviceTraffic,
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

  it('lo reportan el mock y OpenWrt; los otros siete, no', () => {
    const conDesglose = Object.entries(PER_DEVICE_TRAFFIC_BY_KIND)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort();
    // US-251 sacó a OpenWrt de la lista de los que no pueden. El resto sigue ahí,
    // y cada uno necesita su propia vía y su propia historia.
    expect(conDesglose).toEqual(['mock', 'openwrt']);
    expect(reportsPerDeviceTraffic('unifi')).toBe(false);
  });

  /**
   * El guard que de verdad protege: lo DECLARADO debe coincidir con lo que el
   * driver hace. Un driver que declara `false` tiene que devolver literalmente
   * `devices: []`; el día que alguien le implemente el desglose, ese literal
   * desaparecerá y este test le obligará a actualizar el mapa — que es justo lo
   * que hace que la UI deje de mentir. (Pasó en US-251 con OpenWrt.)
   */
  it('cada driver sin desglose devuelve `devices: []` de verdad en su código', () => {
    for (const [kind, reporta] of Object.entries(PER_DEVICE_TRAFFIC_BY_KIND)) {
      if (reporta) continue;
      const src = driverSource(kind);
      expect(src, `${kind}.driver.ts declara NO reportar pero no devuelve devices: []`)
        .toMatch(/devices:\s*\[\]/);
    }
  });

  /**
   * La otra mitad del guard, que US-251 hizo necesaria: declarar `true` sin tener
   * de dónde sacar el dato prometería otra vez un bienestar digital vacío. Cada
   * kind capaz declara **de dónde sale** su desglose, y añadir uno obliga a
   * escribirlo aquí.
   */
  const FUENTE_DEL_DESGLOSE: Record<string, RegExp> = {
    mock: /devices:\s*this\.trafficDevices/, // lista simulada, no vacía
    openwrt: /parseNlbwJson/, // contabilidad real de nlbwmon (US-251)
  };

  it('cada driver CON desglose tiene una fuente real de la que sacarlo', () => {
    for (const [kind, reporta] of Object.entries(PER_DEVICE_TRAFFIC_BY_KIND)) {
      if (!reporta) continue;
      const fuente = FUENTE_DEL_DESGLOSE[kind];
      expect(fuente, `${kind} declara reportar el desglose pero no dice de dónde sale`).toBeDefined();
      expect(driverSource(kind), `${kind}.driver.ts no usa su fuente declarada`).toMatch(fuente!);
    }
    // Guard de tamaño: si la recolección se rompiera, el bucle no iteraría y el
    // test pasaría en vacío.
    expect(Object.keys(FUENTE_DEL_DESGLOSE).length).toBeGreaterThanOrEqual(2);
  });
});

describe('resolvePerDeviceTraffic (US-251)', () => {
  it('cae al mapa declarado si el driver no sabe sondear', async () => {
    expect(await resolvePerDeviceTraffic({ kind: 'unifi' })).toEqual({ status: 'unsupported' });
    expect(await resolvePerDeviceTraffic({ kind: 'mock' })).toEqual({ status: 'supported' });
  });

  it('usa el estado REAL del driver cuando lo sabe', async () => {
    const capability = await resolvePerDeviceTraffic({
      kind: 'openwrt',
      perDeviceTrafficCapability: () =>
        Promise.resolve({ status: 'requires-setup' as const, setup: 'nlbwmon' as const }),
    });
    expect(capability).toEqual({ status: 'requires-setup', setup: 'nlbwmon' });
  });

  it('un sondeo que falla NO acusa al router de no poder', async () => {
    // Con el router inalcanzable, decir «tu router no reparte el tráfico» mandaría
    // al usuario a cambiar de hardware por un problema de red.
    const capability = await resolvePerDeviceTraffic({
      kind: 'openwrt',
      perDeviceTrafficCapability: () => Promise.reject(new Error('ssh caído')),
    });
    expect(capability).toEqual(declaredCapability('openwrt'));
    expect(capability.status).not.toBe('unsupported');
  });
});
