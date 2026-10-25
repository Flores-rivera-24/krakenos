import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrateDatabase } from '../../src/db/migrate.js';
import { encryptArchive, packArchive } from '../../src/system/backup.js';
import {
  applyStagedRestore,
  RestoreFromNewerVersionError,
  stageRestoreAsync,
  stageRestoreFromFileAsync,
  type RestoreTargets,
} from '../../src/system/restore.js';
import { migrateWithRestoreSafety } from '../../src/system/boot-migrate.js';
import { keyFilePaths } from '../../src/system/key-paths.js';

/**
 * Restaurar una copia de una versión MÁS NUEVA del agente: el aplicador de migraciones
 * saldría con 1 en cada arranque (bucle de reinicio). Dos capas: se rechaza al preparar
 * el staging, y si aun así llega al arranque se devuelve la base previa.
 * Todo sobre bases SQLite reales y directorios temporales (nunca `var/` real).
 */

const PASS = 'restaurar-larga-1';

function sandbox(): { dir: string; migrations: string } {
  const dir = mkdtempSync(join(tmpdir(), 'kr-restore-newer-'));
  const migrations = join(dir, 'migrations');
  for (const [name, sql] of [
    ['20260101000000_uno', 'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);'],
    ['20260102000000_dos', 'ALTER TABLE t ADD COLUMN w TEXT;'],
  ] as const) {
    mkdirSync(join(migrations, name), { recursive: true });
    writeFileSync(join(migrations, name, 'migration.sql'), sql);
  }
  return { dir, migrations };
}

/** Base migrada con las migraciones del sandbox; con `extra`, una que este código no conoce. */
function baseMigrada(dir: string, migrations: string, file: string, extra: boolean): string {
  const dbFile = join(dir, file);
  migrateDatabase({ dbFile, migrationsDir: migrations, backupDir: join(dir, 'var-' + file) });
  const db = new Database(dbFile);
  // Como la base real (WAL): el fichero lo conserva en la cabecera aunque se cierre sin `-wal`.
  db.pragma('journal_mode = WAL');
  db.exec("INSERT INTO t (id, v) VALUES (1, 'de-la-copia')");
  if (extra) {
    db.prepare(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
       VALUES ('x', 'abc', 1, '29990101000000_futura', 1, 1)`,
    ).run();
  }
  db.close();
  return dbFile;
}

function archivo(dir: string, dbFile: string): string {
  const out = join(dir, 'copia.kbk');
  writeFileSync(
    out,
    encryptArchive(packArchive([{ name: 'db/app.db', data: readFileSync(dbFile) }]), PASS),
  );
  return out;
}

describe('rechazo al preparar el staging', () => {
  it('stageRestoreFromFileAsync rechaza una copia con migración desconocida y no deja staging', async () => {
    const { dir, migrations } = sandbox();
    const copia = archivo(dir, baseMigrada(dir, migrations, 'nueva.db', true));
    const staging = join(dir, 'staging');

    const err = await stageRestoreFromFileAsync(copia, PASS, staging, migrations).catch((e) => e);
    expect(err).toBeInstanceOf(RestoreFromNewerVersionError);
    expect((err as RestoreFromNewerVersionError).message).toContain('29990101000000_futura');
    expect(existsSync(staging)).toBe(false);
    expect(existsSync(`${staging}.incoming`)).toBe(false);
  });

  it('stageRestoreAsync también rechaza y limpia', async () => {
    const { dir, migrations } = sandbox();
    const copia = archivo(dir, baseMigrada(dir, migrations, 'nueva.db', true));
    const staging = join(dir, 'staging');

    await expect(
      stageRestoreAsync(readFileSync(copia), PASS, staging, migrations),
    ).rejects.toBeInstanceOf(RestoreFromNewerVersionError);
    expect(existsSync(staging)).toBe(false);
  });

  it('control: una copia con las migraciones conocidas sí se prepara', async () => {
    const { dir, migrations } = sandbox();
    const copia = archivo(dir, baseMigrada(dir, migrations, 'ok.db', false));
    const staging = join(dir, 'staging');

    await stageRestoreFromFileAsync(copia, PASS, staging, migrations);
    expect(existsSync(join(staging, 'db/app.db'))).toBe(true);
  });
});

describe('red de seguridad en el arranque', () => {
  it('devuelve la base previa (con su WAL) si la restaurada trae una migración desconocida', () => {
    const { dir, migrations } = sandbox();
    const dbFile = baseMigrada(dir, migrations, 'app.db', false);
    const previa = readFileSync(dbFile);
    writeFileSync(`${dbFile}-wal`, 'WAL-VIEJO');

    const staging = join(dir, 'staging');
    mkdirSync(join(staging, 'db'), { recursive: true });
    writeFileSync(
      join(staging, 'db/app.db'),
      readFileSync(baseMigrada(dir, migrations, 'nueva.db', true)),
    );
    const targets: RestoreTargets = {
      dbFile,
      keysDir: join(dir, 'keys'),
      keyFiles: keyFilePaths({
        jwtPrivateKeyPath: join(dir, 'keys', 'jwt-private.pem'),
        jwtPublicKeyPath: join(dir, 'keys', 'jwt-public.pem'),
        secretboxKeyPath: join(dir, 'keys', 'secretbox.key'),
      }),
      dataDir: join(dir, 'data'),
    };
    const preRestoreDir = join(dir, 'pre-restore-X');
    applyStagedRestore(staging, targets, preRestoreDir);
    expect(existsSync(`${dbFile}-wal`)).toBe(false);

    const logs: string[] = [];
    const walAlReintentar: (string | null)[] = [];
    let intentos = 0;
    const res = migrateWithRestoreSafety({
      restored: { preRestoreDir, targets },
      migrate: () => {
        intentos += 1;
        // SQLite consume un WAL ilegible al abrir: se mira justo antes del reintento.
        if (intentos === 2) {
          walAlReintentar.push(
            existsSync(`${dbFile}-wal`) ? readFileSync(`${dbFile}-wal`, 'utf8') : null,
          );
        }
        return migrateDatabase({ dbFile, migrationsDir: migrations, backupDir: join(dir, 'var') });
      },
      log: (m) => logs.push(m),
    });

    expect(res.revertedRestore).toBe(true);
    expect(readFileSync(dbFile).equals(previa)).toBe(true);
    expect(walAlReintentar).toEqual(['WAL-VIEJO']);
    expect(logs.join('\n')).toContain('29990101000000_futura');
  });

  it('sin restauración reciente, una migración desconocida sigue siendo fatal', () => {
    const { dir, migrations } = sandbox();
    const dbFile = baseMigrada(dir, migrations, 'app.db', true);
    expect(() =>
      migrateWithRestoreSafety({
        restored: null,
        migrate: () =>
          migrateDatabase({ dbFile, migrationsDir: migrations, backupDir: join(dir, 'var') }),
        log: () => undefined,
      }),
    ).toThrow(/no existe en esta versión/);
  });
});
