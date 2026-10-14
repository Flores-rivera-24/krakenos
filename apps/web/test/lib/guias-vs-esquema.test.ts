import { describe, expect, it } from 'vitest';
import type { IntegrationDomain } from '@krakenos/types';
import { GUIDES, type GuideDomain } from '@/lib/guides';
// El catálogo técnico vive en el agente. Es un módulo puro (solo importa tipos de
// `@krakenos/types`: ni Prisma ni Fastify), así que la web puede leerlo en un test
// sin arrastrar nada. La dirección contraria no vale: `apps/agent/tsconfig.test.json`
// fija `rootDir: "."` y no puede importar de `apps/web`.
import { INTEGRATION_SCHEMA } from '../../../agent/src/integrations/schema';

/**
 * `GuideField.key` «DEBE coincidir con la clave de config del backend» (lo dice su
 * comentario en `guides/types.ts`) y nadie lo comprobaba. Si no casa, el asistente
 * (`IntegrationWizard`) no encuentra la copia de usuario del campo y lo pinta sin
 * ayuda, o la guía describe un campo que el backend no lee. Ninguno da error.
 *
 * Las mismas dos tablas de traducción que usa `ConnectPage` para pasar de guía a
 * backend (`GUIDE_DOMAIN`, `KIND_ALIASES`) se repiten aquí; si cambian allí y no
 * aquí, el test de «cada guía resuelve su esquema» se pone rojo.
 */
const GUIDE_DOMAIN: Record<GuideDomain, IntegrationDomain> = {
  driver: 'driver',
  iot: 'iot',
  vpn: 'vpn',
  camera: 'cameras',
  dns: 'dns',
  firewall: 'firewall',
  vlan: 'vlan',
  qos: 'qos',
};
const KIND_ALIASES: Record<string, string> = { tapo: 'kasa' };

/** Guías cuyo `kind` no existe en el esquema, con su motivo. */
const GUIA_SIN_ESQUEMA = new Map<string, string>();

/** `guia: clave` de campo que no existe en el esquema, con su motivo. */
const CLAVE_SIN_ESQUEMA = new Map<string, string>([
  ...['name', 'ip', 'deviceId', 'localKey', 'version'].map((k): [string, string] => [
    `tuya: ${k}`,
    'por diseno: los focos Tuya se registran uno a uno en su gestor propio (/api/iot/tuya); el esquema no tiene campos',
  ]),
  ...['name', 'rtspUrl', 'room', 'model'].map((k): [string, string] => [
    `rtsp: ${k}`,
    'por diseno: las camaras se dan de alta por el CRUD /api/cameras, no por la config del dominio',
  ]),
  [
    'wireguard: name',
    'por diseno: el nombre es del peer (alta de peer), no de la config de la VPN',
  ],
]);

describe('guías in-app vs INTEGRATION_SCHEMA', () => {
  it('hay guías con campos que comprobar (guard de tamaño)', () => {
    expect(GUIDES.length).toBeGreaterThan(15);
    expect(GUIDES.filter((g) => g.fields.length > 0).length).toBeGreaterThan(10);
  });

  it('cada guía resuelve su dominio/kind en el esquema del backend', () => {
    const sinEsquema = GUIDES.filter((g) => {
      const kind = KIND_ALIASES[g.kind] ?? g.kind;
      return !INTEGRATION_SCHEMA[GUIDE_DOMAIN[g.domain]]?.[kind];
    })
      .filter((g) => !GUIA_SIN_ESQUEMA.has(g.id))
      .map((g) => `${g.id} (${g.domain}/${g.kind})`);
    expect(sinEsquema).toEqual([]);
  });

  it('cada key de campo de una guía existe en el esquema de su kind', () => {
    const rotas: string[] = [];
    for (const g of GUIDES) {
      const kind = KIND_ALIASES[g.kind] ?? g.kind;
      const esquema = INTEGRATION_SCHEMA[GUIDE_DOMAIN[g.domain]]?.[kind];
      if (!esquema) continue; // lo reporta el test anterior
      const claves = new Set(esquema.fields.map((f) => f.key));
      for (const f of g.fields) {
        const k = `${g.id}: ${f.key}`;
        if (!claves.has(f.key) && !CLAVE_SIN_ESQUEMA.has(k)) rotas.push(k);
      }
    }
    expect(rotas).toEqual([]);
  });

  it('los allowlists no tienen entradas muertas', () => {
    const sobran: string[] = [];
    for (const id of GUIA_SIN_ESQUEMA.keys()) {
      const g = GUIDES.find((x) => x.id === id);
      const kind = g && (KIND_ALIASES[g.kind] ?? g.kind);
      if (!g || INTEGRATION_SCHEMA[GUIDE_DOMAIN[g.domain]]?.[kind!]) sobran.push(id);
    }
    for (const k of CLAVE_SIN_ESQUEMA.keys()) {
      const [id, key] = k.split(': ') as [string, string];
      const g = GUIDES.find((x) => x.id === id);
      const kind = g && (KIND_ALIASES[g.kind] ?? g.kind);
      const esquema = g && INTEGRATION_SCHEMA[GUIDE_DOMAIN[g.domain]]?.[kind!];
      const tieneCampo = g?.fields.some((f) => f.key === key);
      if (!tieneCampo || esquema?.fields.some((f) => f.key === key)) sobran.push(k);
    }
    expect(sobran).toEqual([]);
  });
});
