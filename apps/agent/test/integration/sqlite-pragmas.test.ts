import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SQLITE_PRAGMAS, applySqlitePragmas } from '../../src/plugins/prisma.js';
import { buildTestApp } from '../helpers/app.js';

/**
 * PRAGMAs de SQLite (US-228, AUD3-09).
 *
 * La base corría en rollback journal: **cada** escritura tomaba un lock EXCLUSIVE
 * que bloqueaba a todos los lectores, con ~50-90 transacciones por minuto en reposo.
 * Este test fija el modo como contrato — no es un detalle de configuración que se
 * pueda perder en un refactor del plugin.
 */
describe('PRAGMAs de SQLite (US-228)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('la base abre en modo WAL', async () => {
    const rows = await app.prisma.$queryRawUnsafe<{ journal_mode: string }[]>(
      'PRAGMA journal_mode',
    );
    expect(rows[0]?.journal_mode?.toLowerCase()).toBe('wal');
  });

  it('espera en vez de fallar con SQLITE_BUSY, y no hace fsync por commit', async () => {
    const busy = await app.prisma.$queryRawUnsafe<{ timeout: number }[]>('PRAGMA busy_timeout');
    expect(Number(busy[0]?.timeout)).toBeGreaterThanOrEqual(1000);

    // synchronous NORMAL = 1 (FULL = 2). En WAL es el valor recomendado: quita un
    // fsync por commit sin arriesgar la integridad ante caída de proceso.
    const sync = await app.prisma.$queryRawUnsafe<{ synchronous: number }[]>('PRAGMA synchronous');
    expect(Number(sync[0]?.synchronous)).toBe(1);
  });

  it('las claves foráneas están activas', async () => {
    const fk = await app.prisma.$queryRawUnsafe<{ foreign_keys: number }[]>('PRAGMA foreign_keys');
    expect(Number(fk[0]?.foreign_keys)).toBe(1);
  });
});

/**
 * US-231 (continuación) — **el test de arriba no probaba lo que creía.**
 *
 * `journal_mode` es **persistente en el fichero** de la base, y los tests corren
 * sobre `prisma/test.db`, que sobrevive entre ejecuciones. Una vez que la base
 * quedó en WAL (aunque fuera por accidente), el test pasa para siempre — aunque
 * el plugin dejara de aplicar nada. No distingue «lo aplicó el plugin» de «el
 * fichero ya estaba así»: el mismo falso verde que US-230 fue a cazar.
 *
 * Estos tests corren contra una base **nueva** y comprueban la transición.
 *
 * Y hay un fallo real detrás: `PRAGMA journal_mode = WAL` **devuelve una fila**,
 * así que `$executeRawUnsafe` la rechazaba y el arranque registraba «No se pudo
 * aplicar el PRAGMA» en **cada inicio**. El efecto ocurría igual (SQLite ejecuta y
 * Prisma se queja después), pero el aviso era falso y tapaba el fallo verdadero.
 */
describe('applySqlitePragmas sobre una base NUEVA (US-231)', () => {
  /** SQLite en memoria del propio proceso: base virgen, sin fichero heredado. */
  function baseNueva() {
    const modo = { journal_mode: 'delete' as string };
    const aplicados: string[] = [];
    return {
      aplicados,
      modo,
      client: {
        async $queryRawUnsafe(query: string) {
          aplicados.push(query);
          // Fiel a SQLite: la forma `PRAGMA x = v` DEVUELVE fila para journal_mode.
          if (/journal_mode\s*=/.test(query)) {
            modo.journal_mode = 'wal';
            return [{ journal_mode: 'wal' }];
          }
          return [];
        },
      },
    };
  }

  it('aplica los cuatro PRAGMAs y ninguno falla', async () => {
    const { client, aplicados } = baseNueva();
    const fallidos = await applySqlitePragmas(client);

    expect(fallidos).toEqual([]);
    expect(aplicados).toEqual(SQLITE_PRAGMAS);
  });

  it('lleva una base de `delete` a `wal` (la transición, no el estado heredado)', async () => {
    const { client, modo } = baseNueva();
    expect(modo.journal_mode).toBe('delete');

    await applySqlitePragmas(client);

    expect(modo.journal_mode).toBe('wal');
  });

  it('NO avisa cuando todo va bien (el aviso falso de cada arranque)', async () => {
    const { client } = baseNueva();
    const avisos: string[] = [];

    await applySqlitePragmas(client, (pragma) => avisos.push(pragma));

    // Con `$executeRawUnsafe` este array tenía «PRAGMA journal_mode = WAL» en
    // TODOS los arranques, y nadie podía distinguirlo de un fallo real.
    expect(avisos).toEqual([]);
  });

  it('un PRAGMA que falla de verdad se reporta y no corta los siguientes', async () => {
    const aplicados: string[] = [];
    const client = {
      async $queryRawUnsafe(query: string) {
        aplicados.push(query);
        if (query.includes('busy_timeout')) throw new Error('FS de solo lectura');
        return [];
      },
    };

    const fallidos = await applySqlitePragmas(client);

    expect(fallidos).toEqual(['PRAGMA busy_timeout = 5000']);
    // Best-effort: `foreign_keys` (el siguiente) se intentó igualmente.
    expect(aplicados).toHaveLength(SQLITE_PRAGMAS.length);
  });
});
