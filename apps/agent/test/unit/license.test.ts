import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * US-257 — **el repositorio no declaraba licencia**, así que legalmente era
 * «todos los derechos reservados»: nadie podía usarlo, modificarlo ni
 * redistribuirlo con confianza, ni siquiera clonándolo del repo público.
 *
 * Este es el test que lo habría cazado. Cubre las tres formas de romperlo:
 *
 * 1. Que desaparezca o se sustituya el fichero `LICENSE`.
 * 2. Que un paquete nuevo del workspace nazca **sin** campo `license` — es el
 *    caso probable, porque `pnpm init` no lo pone y nadie lo echa de menos.
 * 3. Que entre una dependencia de producción con una licencia **incompatible**
 *    con AGPL (SSPL, BUSL, Elastic, CC-BY-NC…). Ese fallo no da la cara al
 *    instalarla: aparece meses después, cuando ya se ha distribuido.
 *
 * Decisión de la licencia y su porqué: `docs/adr-licencia.md`.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SPDX = 'AGPL-3.0-or-later';

/**
 * Licencias que pueden combinarse dentro de una obra AGPL-3.0. La compatibilidad
 * de Apache-2.0, MPL-2.0 y Python-2.0 va **en un solo sentido** (entran en AGPL,
 * no al revés), que es justo el sentido que necesitamos. La lista es una
 * allowlist a propósito: lo desconocido **falla**, no se asume compatible.
 */
const COMPATIBLES = new Set([
  '0BSD',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT AND ISC',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
]);

type Pkg = {
  name?: string;
  license?: unknown;
  dependencies?: Record<string, string>;
};

const leerPkg = (ruta: string): Pkg => JSON.parse(readFileSync(ruta, 'utf8')) as Pkg;

/**
 * Los paquetes del workspace se **descubren** desde `pnpm-workspace.yaml` en vez
 * de listarlos a mano: un paquete nuevo tiene que entrar solo en el barrido, o
 * este test protegería exactamente los cuatro que ya estaban bien.
 */
function paquetesDelWorkspace(): string[] {
  const yaml = readFileSync(`${ROOT}pnpm-workspace.yaml`, 'utf8');
  const globs = [...yaml.matchAll(/^\s*-\s*"?([^"\s]+)"?\s*$/gm)].map((m) => m[1] ?? '');
  const rutas = [`${ROOT}package.json`];
  for (const glob of globs) {
    const dir = glob.replace(/\/\*$/, '');
    const base = `${ROOT}${dir}`;
    if (!glob.endsWith('/*') || !existsSync(base)) continue;
    for (const hijo of readdirSync(base)) {
      const pkg = `${base}/${hijo}/package.json`;
      if (statSync(`${base}/${hijo}`).isDirectory() && existsSync(pkg)) rutas.push(pkg);
    }
  }
  return rutas;
}

/**
 * Resuelve el `package.json` instalado de una dependencia. pnpm enlaza las deps
 * directas en el `node_modules` del propio paquete; la raíz es el fallback.
 */
function rutaInstalada(dueño: string, dep: string): string | null {
  for (const base of [`${ROOT}${dueño}/node_modules`, `${ROOT}node_modules`]) {
    const ruta = `${base}/${dep}/package.json`;
    if (existsSync(ruta)) return ruta;
  }
  return null;
}

describe('licencia del proyecto (US-257)', () => {
  it('declara AGPL-3.0 en la raíz con el texto íntegro de la FSF', () => {
    const ruta = `${ROOT}LICENSE`;
    expect(existsSync(ruta)).toBe(true);

    const texto = readFileSync(ruta, 'utf8');
    expect(texto).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(texto).toContain('Version 3, 19 November 2007');
    // La §13 es la cláusula que distingue a la AGPL de la GPL y la razón de
    // elegirla: sin ella, un tercero puede hospedar una versión modificada sin
    // publicar nada. Si falta, el fichero NO es la licencia que declaramos.
    expect(texto).toContain('13. Remote Network Interaction');
    // Guard de tamaño: un LICENSE recortado a un párrafo pasaría lo de arriba.
    expect(texto.length).toBeGreaterThan(30_000);
  });

  it('todos los paquetes del workspace declaran el mismo SPDX', () => {
    const rutas = paquetesDelWorkspace();
    // Guard de recolección: si el descubrimiento se rompe, la lista sale vacía
    // y el test pasaría sin comprobar nada.
    expect(rutas.length).toBeGreaterThanOrEqual(4);

    const sinLicencia = rutas.filter((r) => leerPkg(r).license !== SPDX);
    expect(sinLicencia.map((r) => r.replace(ROOT, ''))).toEqual([]);
  });

  it('ninguna dependencia directa de producción es incompatible con AGPL', () => {
    const dueños = ['apps/agent', 'apps/web'];
    const incompatibles: string[] = [];
    let comprobadas = 0;

    for (const dueño of dueños) {
      const deps = Object.keys(leerPkg(`${ROOT}${dueño}/package.json`).dependencies ?? {});
      for (const dep of deps) {
        comprobadas += 1;
        const ruta = rutaInstalada(dueño, dep);
        // Falla cerrado: una dependencia que no se puede leer no se da por buena.
        if (!ruta) {
          incompatibles.push(`${dep} (no instalada — ¿falta \`pnpm install\`?)`);
          continue;
        }
        const licencia = leerPkg(ruta).license;
        if (typeof licencia !== 'string' || !COMPATIBLES.has(licencia)) {
          incompatibles.push(`${dep} → ${String(licencia)}`);
        }
      }
    }

    expect(comprobadas).toBeGreaterThanOrEqual(20);
    expect(incompatibles).toEqual([]);
  });
});
