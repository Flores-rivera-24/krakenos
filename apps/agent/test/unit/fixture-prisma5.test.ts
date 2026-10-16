import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRISMA5_DB, PRISMA5_DIR, leerOraculo } from '../helpers/prisma5-fixture.js';

/**
 * US-276 — la fixture escrita por Prisma 5 es lo que prueba que una instalación REAL
 * sobrevive a la subida a Prisma 7. Este test no usa Prisma: comprueba, con el SQLite
 * crudo, que el fichero y su oráculo siguen siendo coherentes entre sí (si alguien
 * regenera uno sin el otro, o lo toca a mano, el gate de la subida compararía contra
 * nada).
 */
describe('fixture de Prisma 5 (US-276)', () => {
  let tmp: string;
  let dbFile: string;

  beforeEach(() => {
    // Copia: abrir un fichero con better-sqlite3 puede dejar `-wal`/`-shm` al lado y
    // la fixture versionada no se toca nunca.
    tmp = mkdtempSync(join(tmpdir(), 'kr-fixture-p5-'));
    dbFile = join(tmp, 'p5.db');
    copyFileSync(PRISMA5_DB, dbFile);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('es una base íntegra, en modo `delete` y sin ficheros auxiliares', () => {
    expect(readdirSync(PRISMA5_DIR).sort()).toEqual(['oraculo.json', 'prisma5.db']);
    const db = new Database(dbFile, { readonly: true });
    try {
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('journal_mode', { simple: true })).toBe('delete');
    } finally {
      db.close();
    }
  });

  it('el oráculo se leyó con Prisma 5 y la base lleva las migraciones que dice', () => {
    const oraculo = leerOraculo();
    expect(oraculo.generadoCon).toBe('prisma 5.22.0');

    const db = new Database(dbFile, { readonly: true });
    try {
      const enBase = (
        db
          .prepare('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name')
          .all() as {
          migration_name: string;
        }[]
      ).map((r) => r.migration_name);
      expect(enBase).toEqual(oraculo.migraciones);
    } finally {
      db.close();
    }

    // Todas las migraciones de la fixture siguen existiendo en el repo (una base
    // más antigua se migra hacia delante; una que el repo ya no conoce no).
    const enDisco = readdirSync(resolve(PRISMA5_DIR, '../../../prisma/migrations'));
    for (const m of oraculo.migraciones) expect(enDisco).toContain(m);
  });

  it('las fechas que Prisma 5 dejó en el fichero son INTEGER en ms y coinciden con el oráculo', () => {
    const oraculo = leerOraculo();
    const db = new Database(dbFile, { readonly: true });
    try {
      let comprobadas = 0;
      for (const [tablaColumna, filas] of Object.entries(oraculo.fechasCrudas)) {
        const [tabla, columna] = tablaColumna.split('.') as [string, string];
        const clave = tabla === 'Setting' ? 'key' : 'id';
        const reales = db
          .prepare(
            `SELECT ${clave} AS k, typeof("${columna}") AS t, "${columna}" AS v FROM "${tabla}" ORDER BY ${clave}`,
          )
          .all() as { k: string; t: string; v: number | null }[];
        expect(reales).toEqual(filas);
        comprobadas += filas.length;
      }
      // Guard de tamaño: si la recolección se rompe, la lista sale vacía y el test pasa.
      expect(comprobadas).toBeGreaterThan(100);
      expect(
        Object.values(oraculo.fechasCrudas)
          .flat()
          .some((f) => f.t === 'integer'),
      ).toBe(true);
    } finally {
      db.close();
    }
  });
});
