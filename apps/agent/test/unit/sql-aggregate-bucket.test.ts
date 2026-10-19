import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bucketStart } from '../../src/db/sql-aggregate.js';

/**
 * US-276 — el bucket temporal se construye con `bucketStart()` (BigInt) y en ningún
 * otro sitio. Con el adaptador de better-sqlite3 un `number` interpolado se enlaza
 * como REAL y `timestamp / ${ancho}` pasa a dividir en flotante: cada fila forma su
 * propio bucket, sin ningún error. El comportamiento lo prueba `prisma7-fixture.test.ts`
 * contra el oráculo de Prisma 5; este gate cierra la puerta a que un informe NUEVO
 * escriba la aritmética a mano.
 */

const SRC = resolve(import.meta.dirname, '../../src');
const A_MANO = /timestamp\s*\/\s*\$\{/;

function fuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'generated' ? [] : fuentes(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

describe('bucket temporal en SQL (US-276)', () => {
  it('el detector reconoce la forma peligrosa (control positivo)', () => {
    expect(A_MANO.test('SELECT (timestamp / ${bucketMs}) * ${bucketMs} AS bucket')).toBe(true);
    expect(A_MANO.test('SELECT ${bucketStart(bucketMs)} AS bucket')).toBe(false);
  });

  it('ningún fichero de src divide `timestamp` por un parámetro a mano', () => {
    const archivos = fuentes(SRC);
    expect(archivos.length).toBeGreaterThan(200); // guard: la recolección no se quedó vacía
    const culpables = archivos
      .map((f) => relative(SRC, f))
      // El único punto que construye el fragmento es `bucketStart()` (con BigInt).
      .filter((f) => f !== 'db/sql-aggregate.ts')
      .filter((f) => A_MANO.test(readFileSync(join(SRC, f), 'utf8')));
    expect(culpables).toEqual([]);
  });

  it('los tres informes agregados usan `bucketStart()`', () => {
    const usan = fuentes(join(SRC, 'modules'))
      .filter((f) => /bucketStart\(bucketMs\)/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
      .sort();
    expect(usan).toEqual([
      'modules/energy/energy.service.ts',
      'modules/traffic/traffic.service.ts',
      'modules/wellbeing/wellbeing.service.ts',
    ]);
  });

  it('el fragmento lleva el ancho como entero (BigInt), no como número', () => {
    const frag = bucketStart(300_000.7);
    expect(frag.values).toEqual([300_000n, 300_000n]);
  });
});
