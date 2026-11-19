import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrismaClient } from '../../src/db/client.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyStagedRestore } from '../../src/system/restore.js';
import { keyFilePaths } from '../../src/system/key-paths.js';

/** Rutas de las tres claves dentro de `dir` (en producción salen de `keyFilePaths(env)`). */
function clavesEn(dir: string) {
  return keyFilePaths({
    jwtPrivateKeyPath: join(dir, 'jwt-private.pem'),
    jwtPublicKeyPath: join(dir, 'jwt-public.pem'),
    secretboxKeyPath: join(dir, 'secretbox.key'),
  });
}

/**
 * US-274 — restaurar no hereda un `-wal` huérfano.
 *
 * Un `-wal` no está atado al fichero principal: SQLite lo reproduce sobre
 * **cualquier** base que tenga al lado con ese nombre. Si el agente murió sin
 * checkpoint, la base vieja deja `app.db-wal`; al restaurar solo se sustituía
 * `app.db`, y ese WAL se aplicaba encima de la base restaurada.
 *
 * Estos tests corren sobre bases SQLite **reales** (el mismo cliente que usa el
 * agente), no sobre ficheros con texto: con `Buffer.from('DBDATA')` el problema no
 * existe, porque nadie abre esos bytes.
 */

type Fila = { id: bigint | number; v: string };

function cliente(file: string): PrismaClient {
  // Prisma 7: una sola conexión de better-sqlite3 (la `connection_limit=1` de Prisma 5).
  return createPrismaClient({ databaseUrl: `file:${file}` });
}

async function leer(file: string): Promise<{ integridad: string; filas: [number, string][] }> {
  const db = cliente(file);
  try {
    const integ = await db.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check');
    const filas = await db.$queryRawUnsafe<Fila[]>('SELECT id, v FROM t ORDER BY id');
    return {
      integridad: integ.map((r) => r.integrity_check).join(','),
      filas: filas.map((r) => [Number(r.id), r.v]),
    };
  } finally {
    await db.$disconnect();
  }
}

describe('restore y WAL huérfano (US-274)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'kr-restore-wal-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * Deja en `vivo/` el estado de una base A tras un cierre sucio: fichero principal
   * con lo checkpointed y un `-wal` con escrituras posteriores sin checkpoint.
   * El snapshot se copia con la base ABIERTA (como lo vería el arranque tras un
   * `kill -9`); al desconectar, SQLite checkpointaría y borraría el WAL.
   */
  async function baseConCierreSucio(vivoDir: string): Promise<string> {
    const origen = join(tmp, 'origen-a');
    mkdirSync(origen);
    const fuente = join(origen, 'app.db');
    const a = cliente(fuente);
    try {
      await a.$queryRawUnsafe('PRAGMA journal_mode = WAL');
      await a.$queryRawUnsafe('PRAGMA wal_autocheckpoint = 0');
      await a.$executeRawUnsafe('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
      await a.$executeRawUnsafe("INSERT INTO t (id, v) VALUES (1, 'a-base')");
      await a.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
      // Escrituras que SOLO viven en el WAL, con muchas páginas tocadas.
      for (let i = 2; i <= 400; i++) {
        await a.$executeRawUnsafe(
          `INSERT INTO t (id, v) VALUES (${i}, 'a-wal-${i}-${'x'.repeat(120)}')`,
        );
      }
      expect(existsSync(`${fuente}-wal`)).toBe(true);

      mkdirSync(vivoDir, { recursive: true });
      const vivo = join(vivoDir, 'app.db');
      copyFileSync(fuente, vivo);
      copyFileSync(`${fuente}-wal`, `${vivo}-wal`);
      if (existsSync(`${fuente}-shm`)) copyFileSync(`${fuente}-shm`, `${vivo}-shm`);
      return vivo;
    } finally {
      await a.$disconnect();
    }
  }

  /** Base B: la copia a restaurar, con el MISMO esquema y contenido distinto. */
  async function copiaB(destino: string): Promise<void> {
    mkdirSync(join(destino, 'db'), { recursive: true });
    const file = join(destino, 'db', 'app.db');
    const b = cliente(file);
    try {
      await b.$executeRawUnsafe('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
      await b.$executeRawUnsafe("INSERT INTO t (id, v) VALUES (1, 'b-uno')");
      await b.$executeRawUnsafe("INSERT INTO t (id, v) VALUES (2, 'b-dos')");
    } finally {
      await b.$disconnect();
    }
  }

  it('la base restaurada es exactamente la copia, sin reproducir el WAL de la vieja', async () => {
    const vivo = await baseConCierreSucio(join(tmp, 'vivo'));
    const staging = join(tmp, 'staging');
    await copiaB(staging);

    // Control: el estado previo ES un cierre sucio (hay un WAL junto a la base).
    expect(existsSync(`${vivo}-wal`)).toBe(true);

    applyStagedRestore(
      staging,
      {
        dbFile: vivo,
        keysDir: join(tmp, 'keys'),
        keyFiles: clavesEn(join(tmp, 'keys')),
        dataDir: join(tmp, 'data'),
      },
      join(tmp, 'pre-restore'),
    );

    const { integridad, filas } = await leer(vivo);
    expect(integridad).toBe('ok');
    expect(filas).toEqual([
      [1, 'b-uno'],
      [2, 'b-dos'],
    ]);
    // Y el WAL huérfano ya no está (lo abre SQLite al leer, así que se mira tras
    // leer solo para que el contenido sea lo primero en fallar con un mensaje claro).
    expect(existsSync(`${vivo}-wal`)).toBe(false);
    expect(existsSync(`${vivo}-shm`)).toBe(false);
  });

  it('si un fichero posterior falla, la base vieja vuelve CON su WAL (no se pierde lo no checkpointed)', async () => {
    const vivo = await baseConCierreSucio(join(tmp, 'vivo'));
    const staging = join(tmp, 'staging');
    await copiaB(staging);
    // Un destino imposible: `data` existe como FICHERO, así que crear `data/x.json` falla.
    mkdirSync(join(staging, 'data'));
    writeFileSync(join(staging, 'data', 'x.json'), '[]');
    writeFileSync(join(tmp, 'data'), 'no soy un directorio');

    expect(() =>
      applyStagedRestore(
        staging,
        {
          dbFile: vivo,
          keysDir: join(tmp, 'keys'),
          keyFiles: clavesEn(join(tmp, 'keys')),
          dataDir: join(tmp, 'data'),
        },
        join(tmp, 'pre-restore'),
      ),
    ).toThrow();

    expect(existsSync(`${vivo}-wal`)).toBe(true);
    const { integridad, filas } = await leer(vivo);
    expect(integridad).toBe('ok');
    // 400 filas de A: la fila 1 checkpointed y las 399 que solo vivían en el WAL.
    expect(filas).toHaveLength(400);
    expect(filas[399]?.[1]).toMatch(/^a-wal-400-/);
  });

  it('sin WAL previo (caso normal) sigue restaurando, y tolera la ausencia de -wal/-shm', async () => {
    const vivoDir = join(tmp, 'vivo');
    mkdirSync(vivoDir);
    const vivo = join(vivoDir, 'app.db');
    const staging = join(tmp, 'staging');
    await copiaB(staging);

    const aplicados = applyStagedRestore(
      staging,
      {
        dbFile: vivo,
        keysDir: join(tmp, 'keys'),
        keyFiles: clavesEn(join(tmp, 'keys')),
        dataDir: join(tmp, 'data'),
      },
      join(tmp, 'pre-restore'),
    );

    expect(aplicados).toEqual(['db/app.db']);
    const { integridad, filas } = await leer(vivo);
    expect(integridad).toBe('ok');
    expect(filas).toHaveLength(2);
  });
});
