import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checksumOf,
  MigrationError,
  migrateDatabase,
  newViolations,
  planMigrations,
  preMigrateFileName,
  readMigrations,
  staleBackups,
  type AppliedMigration,
  type MigrationErrorCode,
  type MigrationFile,
} from '../../src/db/migrate.js';

/**
 * Aplicador propio de migraciones (US-275). Dos familias:
 *  · lógica pura y base sintética (rápidas): el orden, los rechazos, el rollback;
 *  · gates contra la CLI REAL de Prisma 5 (lentos): la base que deja el aplicador
 *    tiene el esquema del `schema.prisma`, y Prisma y el aplicador se aceptan
 *    mutuamente la misma base.
 */

const here = dirname(fileURLToPath(import.meta.url));
const agentRoot = resolve(here, '../..');
const realMigrations = join(agentRoot, 'prisma', 'migrations');

const tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'krakenos-migrate-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeMigrations(dir: string, entries: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, sql] of Object.entries(entries)) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'migration.sql'), sql);
  }
}

/** Abre la base para inspeccionarla; cierra siempre. */
function inspect<T>(file: string, fn: (db: Database.Database) => T): T {
  const db = new Database(file, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function names(file: string): string[] {
  return inspect(file, (db) =>
    (
      db
        .prepare('SELECT migration_name n FROM _prisma_migrations ORDER BY started_at, n')
        .all() as { n: string }[]
    ).map((r) => r.n),
  );
}
function count(file: string, table: string): number {
  return inspect(
    file,
    (db) => (db.prepare(`SELECT count(*) c FROM "${table}"`).get() as { c: number }).c,
  );
}
function tableExists(file: string, table: string): boolean {
  return inspect(
    file,
    (db) =>
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) !==
      undefined,
  );
}

function expectRefusal(fn: () => unknown, code: MigrationErrorCode, mentions?: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).code).toBe(code);
    if (mentions) expect((err as MigrationError).message).toContain(mentions);
    return;
  }
  throw new Error(`se esperaba un rechazo ${code} y no hubo ninguno`);
}

// ---- Un juego sintético con el patrón de reconstrucción de tablas de Prisma ----

const M1 = `CREATE TABLE "Parent" ("id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "Child" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "parentId" TEXT NOT NULL,
  CONSTRAINT "Child_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent" ("id") ON DELETE CASCADE
);
`;
const M2 = `INSERT INTO "Parent" ("id") VALUES ('p1');
INSERT INTO "Child" ("id", "parentId") VALUES ('c1', 'p1');
`;
/** Igual que las ocho de verdad: PRAGMAs dentro del fichero, DROP del padre, RENAME. */
const M3_REBUILD = `PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Parent" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL DEFAULT 'x');
INSERT INTO "new_Parent" ("id") SELECT "id" FROM "Parent";
DROP TABLE "Parent";
ALTER TABLE "new_Parent" RENAME TO "Parent";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
`;
const BASE = { '001_a': M1, '002_b': M2, '003_c': M3_REBUILD };

function setup(entries: Record<string, string> = BASE) {
  const root = tmp();
  const migrationsDir = join(root, 'migrations');
  writeMigrations(migrationsDir, entries);
  const dbFile = join(root, 'data', 'app.db');
  const backupDir = join(root, 'var');
  const run = (extra: Partial<Parameters<typeof migrateDatabase>[0]> = {}) =>
    migrateDatabase({ dbFile, migrationsDir, backupDir, ...extra });
  return { root, migrationsDir, dbFile, backupDir, run };
}

const file = (name: string, sql = `-- ${name}`): MigrationFile => ({
  name,
  sql,
  checksum: checksumOf(sql),
});
const row = (m: MigrationFile, over: Partial<AppliedMigration> = {}): AppliedMigration => ({
  name: m.name,
  checksum: m.checksum,
  finishedAt: 1,
  rolledBackAt: null,
  ...over,
});

describe('piezas puras (US-275)', () => {
  it('checksumOf es el sha256 hex del contenido', () => {
    expect(checksumOf('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(checksumOf(Buffer.from('abc'))).toBe(checksumOf('abc'));
  });

  it('readMigrations ordena por nombre, ignora lo que no es directorio con migration.sql', () => {
    const { migrationsDir } = setup({ '20260102_b': 'B', '20260101_a': 'A', '20260103_c': 'C' });
    writeFileSync(join(migrationsDir, 'migration_lock.toml'), 'provider = "sqlite"');
    mkdirSync(join(migrationsDir, 'sin_sql'));
    const got = readMigrations(migrationsDir);
    expect(got.map((m) => m.name)).toEqual(['20260101_a', '20260102_b', '20260103_c']);
    expect(got[0]?.checksum).toBe(checksumOf('A'));
  });

  it('planMigrations: lo que falta, en orden; nada si todo está aplicado', () => {
    const [a, b, c] = [file('a'), file('b'), file('c')] as [
      MigrationFile,
      MigrationFile,
      MigrationFile,
    ];
    expect(planMigrations([a, b, c], []).map((m) => m.name)).toEqual(['a', 'b', 'c']);
    expect(planMigrations([a, b, c], [row(a)]).map((m) => m.name)).toEqual(['b', 'c']);
    expect(planMigrations([a, b, c], [row(a), row(b), row(c)])).toEqual([]);
  });

  it('planMigrations: una fila resuelta como rolled-back cuenta como pendiente', () => {
    const [a, b] = [file('a'), file('b')] as [MigrationFile, MigrationFile];
    const plan = planMigrations([a, b], [row(a), row(b, { finishedAt: null, rolledBackAt: 5 })]);
    expect(plan.map((m) => m.name)).toEqual(['b']);
  });

  it('planMigrations se niega nombrando la migración: checksum, a medias, desconocida', () => {
    const [a, b] = [file('a'), file('b')] as [MigrationFile, MigrationFile];
    expectRefusal(
      () => planMigrations([a, b], [row(a, { checksum: 'otro' })]),
      'CHECKSUM_CHANGED',
      '«a»',
    );
    expectRefusal(
      () => planMigrations([a, b], [row(a, { finishedAt: null })]),
      'INCOMPLETE',
      '«a»',
    );
    expectRefusal(
      () => planMigrations([a], [row(a), row(file('futura'))]),
      'UNKNOWN_APPLIED',
      '«futura»',
    );
  });

  it('newViolations solo cuenta lo que supera lo que ya había por (tabla, padre)', () => {
    const v = (table: string, parent: string) => ({ table, parent });
    expect(newViolations([], [])).toEqual([]);
    expect(newViolations([v('A', 'P')], [v('A', 'P')])).toEqual([]);
    expect(newViolations([v('A', 'P')], [v('A', 'P'), v('A', 'P')])).toEqual([v('A', 'P')]);
    expect(newViolations([v('A', 'P')], [v('B', 'P')])).toEqual([v('B', 'P')]);
    expect(newViolations([v('A', 'P'), v('A', 'P')], [v('A', 'P')])).toEqual([]);
  });

  it('las copias previas se nombran ordenables y se podan a las N últimas (sin tocar otros ficheros)', () => {
    const a = preMigrateFileName(new Date('2026-01-01T00:00:00.000Z'));
    const b = preMigrateFileName(new Date('2026-01-02T00:00:00.000Z'));
    expect(a).toBe('pre-migrate-2026-01-01T00-00-00-000Z.db');
    expect(a < b).toBe(true);
    const files = [
      b,
      'notas.txt',
      a,
      'pre-restore-2026',
      'pre-migrate-2026-01-03T00-00-00-000Z.db',
    ];
    expect(staleBackups(files, 2)).toEqual([a]);
    expect(staleBackups(files, 3)).toEqual([]);
    expect(staleBackups(files, 0)).toHaveLength(3);
  });
});

describe('migrateDatabase sobre una base sintética (US-275)', () => {
  it('base nueva: aplica todo en orden, escribe el historial compatible con Prisma y no hace copia', () => {
    const { run, dbFile, backupDir } = setup();
    const res = run();
    expect(res.applied).toEqual(['001_a', '002_b', '003_c']);
    expect(res.backupFile).toBeNull();
    expect(existsSync(backupDir)).toBe(false);

    inspect(dbFile, (db) => {
      const rows = db
        .prepare('SELECT * FROM _prisma_migrations ORDER BY started_at, migration_name')
        .all() as {
        id: string;
        checksum: string;
        finished_at: number;
        migration_name: string;
        logs: unknown;
        rolled_back_at: unknown;
        started_at: number;
        applied_steps_count: number;
      }[];
      expect(rows.map((r) => r.migration_name)).toEqual(['001_a', '002_b', '003_c']);
      expect(rows[0]?.checksum).toBe(checksumOf(M1));
      for (const r of rows) {
        expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(r.finished_at).toBeGreaterThan(1_700_000_000_000); // ms, como Prisma
        expect(r.finished_at).toBeGreaterThanOrEqual(r.started_at);
        expect(r.logs).toBeNull();
        expect(r.rolled_back_at).toBeNull();
        expect(r.applied_steps_count).toBe(1);
      }
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    });
  });

  it('es idempotente: la segunda vez no aplica nada ni hace copia', () => {
    const { run, backupDir } = setup();
    run();
    const second = run();
    expect(second).toEqual({ applied: [], backupFile: null });
    expect(existsSync(backupDir)).toBe(false);
  });

  it('reconstruir un padre con foreign_keys=OFF NO se lleva por delante a sus hijos', () => {
    // Si el PRAGMA fuera dentro de la transacción (donde no hace nada), el DROP TABLE
    // del padre dispararía ON DELETE CASCADE y Child quedaría vacía, sin ningún error.
    const { run, dbFile } = setup();
    run();
    expect(count(dbFile, 'Child')).toBe(1);
    expect(count(dbFile, 'Parent')).toBe(1);
    inspect(dbFile, (db) => {
      const cols = (db.prepare('PRAGMA table_info("Parent")').all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).toEqual(['id', 'name']);
    });
  });

  it('con pendientes y base existente, copia previa por VACUUM INTO con los datos de antes', () => {
    const { run, dbFile, backupDir, migrationsDir } = setup();
    run();
    writeMigrations(migrationsDir, { '004_d': `INSERT INTO "Parent" ("id") VALUES ('p2');` });
    const res = run({ now: () => new Date('2026-03-04T05:06:07.000Z') });
    expect(res.applied).toEqual(['004_d']);
    expect(res.backupFile).toBe(join(backupDir, 'pre-migrate-2026-03-04T05-06-07-000Z.db'));
    // La copia es la base de ANTES: 1 padre, no 2, y sin la migración 004.
    expect(count(res.backupFile as string, 'Parent')).toBe(1);
    expect(names(res.backupFile as string)).toEqual(['001_a', '002_b', '003_c']);
    expect(count(dbFile, 'Parent')).toBe(2);
  });

  // En Windows los bits de modo POSIX no significan nada (los permisos son ACL).
  it.skipIf(process.platform === 'win32')(
    'la copia previa (la base entera) es 0600 y el directorio que se crea 0700',
    () => {
      const { run, backupDir, migrationsDir } = setup();
      run();
      writeMigrations(migrationsDir, { '004_d': `CREATE TABLE "T4" ("id" TEXT);` });
      const res = run();
      expect(statSync(res.backupFile as string).mode & 0o777).toBe(0o600);
      expect(statSync(backupDir).mode & 0o777).toBe(0o700);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'una copia previa que ya existía con modo abierto se deja en 0600',
    () => {
      const { run, backupDir, migrationsDir } = setup();
      run();
      writeMigrations(migrationsDir, { '004_d': `CREATE TABLE "T4" ("id" TEXT);` });
      const now = () => new Date('2026-03-04T05:06:07.000Z');
      mkdirSync(backupDir, { recursive: true });
      const dest = join(backupDir, preMigrateFileName(now()));
      writeFileSync(dest, '', { mode: 0o644 });
      chmodSync(dest, 0o644);
      const res = run({ now });
      expect(res.backupFile).toBe(dest);
      expect(statSync(dest).mode & 0o777).toBe(0o600);
    },
  );

  it('retención: se conservan las 3 últimas copias y no se tocan otros ficheros del directorio', () => {
    const { run, backupDir, migrationsDir } = setup({ '001_a': M1 });
    run();
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, 'notas.txt'), 'mío');
    mkdirSync(join(backupDir, 'pre-restore-2026'));
    for (let i = 2; i <= 6; i++) {
      writeMigrations(migrationsDir, { [`00${i}_x`]: `CREATE TABLE "T${i}" ("id" TEXT);` });
      run({ now: () => new Date(Date.UTC(2026, 0, i)) });
    }
    const left = readdirSync(backupDir).sort();
    expect(left.filter((f) => f.startsWith('pre-migrate-'))).toEqual([
      'pre-migrate-2026-01-04T00-00-00-000Z.db',
      'pre-migrate-2026-01-05T00-00-00-000Z.db',
      'pre-migrate-2026-01-06T00-00-00-000Z.db',
    ]);
    expect(left).toContain('notas.txt');
    expect(left).toContain('pre-restore-2026');
  });

  it('sin espacio para la copia se niega ANTES de tocar nada', () => {
    const { run, dbFile, migrationsDir } = setup();
    run();
    writeMigrations(migrationsDir, { '004_d': `CREATE TABLE "T4" ("id" TEXT);` });
    expectRefusal(() => run({ freeBytes: () => 10 }), 'NO_SPACE');
    expect(tableExists(dbFile, 'T4')).toBe(false);
    expect(names(dbFile)).toEqual(['001_a', '002_b', '003_c']);
  });

  it('checksum alterado: se niega nombrando la migración, sin copia y con la base intacta', () => {
    const { run, dbFile, migrationsDir, backupDir } = setup();
    run();
    writeMigrations(migrationsDir, { '002_b': `${M2}-- editada a posteriori\n` });
    writeMigrations(migrationsDir, { '004_d': `CREATE TABLE "T4" ("id" TEXT);` });
    expectRefusal(() => run(), 'CHECKSUM_CHANGED', '002_b');
    expect(tableExists(dbFile, 'T4')).toBe(false);
    expect(existsSync(backupDir)).toBe(false);
  });

  it('una migración a medias (sin finished_at) se niega nombrándola', () => {
    const { run, dbFile } = setup();
    run();
    const db = new Database(dbFile);
    db.prepare(
      "UPDATE _prisma_migrations SET finished_at = NULL WHERE migration_name = '002_b'",
    ).run();
    db.close();
    expectRefusal(() => run(), 'INCOMPLETE', '002_b');
  });

  it('una migración que está en la base y no en disco (downgrade) se niega nombrándola', () => {
    const { run, migrationsDir } = setup();
    run();
    rmSync(join(migrationsDir, '003_c'), { recursive: true });
    expectRefusal(() => run(), 'UNKNOWN_APPLIED', '003_c');
  });

  it('una base con tablas pero sin historial no es nuestra: no se toca', () => {
    const { run, dbFile } = setup();
    mkdirSync(dirname(dbFile), { recursive: true });
    const db = new Database(dbFile);
    db.exec('CREATE TABLE ajena (id INTEGER)');
    db.close();
    expectRefusal(() => run(), 'DB_NOT_EMPTY');
    expect(tableExists(dbFile, '_prisma_migrations')).toBe(false);
  });

  it('un directorio sin migraciones es un error, no «base al día»', () => {
    const { run, migrationsDir } = setup();
    rmSync(migrationsDir, { recursive: true });
    mkdirSync(migrationsDir);
    expectRefusal(() => run(), 'NO_MIGRATIONS');
  });

  it('violación de FK provocada por la migración: rollback, la base queda como estaba y sin fila', () => {
    const { run, dbFile, migrationsDir } = setup();
    run();
    writeMigrations(migrationsDir, {
      '004_roto': `INSERT INTO "Child" ("id", "parentId") VALUES ('c2', 'fantasma');`,
    });
    expectRefusal(() => run(), 'FK_VIOLATION', '004_roto');
    expect(count(dbFile, 'Child')).toBe(1);
    expect(names(dbFile)).toEqual(['001_a', '002_b', '003_c']);
    inspect(dbFile, (db) => expect(db.pragma('integrity_check', { simple: true })).toBe('ok'));
  });

  it('el mensaje de la violación nombra tabla y padre', () => {
    const { run, migrationsDir } = setup();
    run();
    writeMigrations(migrationsDir, {
      '004_roto': `INSERT INTO "Child" ("id", "parentId") VALUES ('c2', 'fantasma');`,
    });
    expectRefusal(() => run(), 'FK_VIOLATION', 'Child → Parent');
  });

  it('migración que falla a medias: lo que hizo antes del fallo se deshace y no hay fila', () => {
    const { run, dbFile, migrationsDir } = setup();
    run();
    writeMigrations(migrationsDir, {
      '004_media': `CREATE TABLE "Mitad" ("id" TEXT);
INSERT INTO "Parent" ("id") VALUES ('p9');
INSERT INTO "no_existe" ("id") VALUES ('x');`,
    });
    expectRefusal(() => run(), 'APPLY_FAILED', '004_media');
    expect(tableExists(dbFile, 'Mitad')).toBe(false);
    expect(count(dbFile, 'Parent')).toBe(1);
    expect(names(dbFile)).toEqual(['001_a', '002_b', '003_c']);
  });

  it('un fallo no impide el siguiente intento una vez corregida la migración', () => {
    const { run, dbFile, migrationsDir } = setup();
    run();
    writeMigrations(migrationsDir, { '004_x': `INSERT INTO "no_existe" VALUES (1);` });
    expectRefusal(() => run(), 'APPLY_FAILED');
    writeMigrations(migrationsDir, { '004_x': `CREATE TABLE "Bien" ("id" TEXT);` });
    expect(run().applied).toEqual(['004_x']);
    expect(tableExists(dbFile, 'Bien')).toBe(true);
  });

  it('una migración que cierra la transacción por su cuenta se rechaza', () => {
    const { run, dbFile, migrationsDir } = setup();
    run();
    writeMigrations(migrationsDir, { '004_x': `CREATE TABLE "Z" ("id" TEXT);\nCOMMIT;` });
    expectRefusal(() => run(), 'APPLY_FAILED', '004_x');
    expect(names(dbFile)).toEqual(['001_a', '002_b', '003_c']);
  });

  it('huérfanas heredadas no bloquean el arranque; una huérfana NUEVA sí', () => {
    const { run, dbFile, migrationsDir } = setup();
    run();
    const db = new Database(dbFile);
    db.pragma('foreign_keys = OFF');
    db.prepare("INSERT INTO Child (id, parentId) VALUES ('vieja', 'nadie')").run();
    db.close();

    writeMigrations(migrationsDir, { '004_ok': `CREATE TABLE "Otra" ("id" TEXT);` });
    expect(run().applied).toEqual(['004_ok']);

    writeMigrations(migrationsDir, {
      '005_mas': `INSERT INTO "Child" ("id", "parentId") VALUES ('nueva', 'nadie');`,
    });
    expectRefusal(() => run(), 'FK_VIOLATION', '005_mas');
    expect(count(dbFile, 'Child')).toBe(2);
  });
});

// ---- Gates contra la CLI real de Prisma -------------------------------------

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

function prisma(args: string[], dbFile?: string): string {
  return execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: agentRoot,
    env: { ...process.env, ...(dbFile ? { DATABASE_URL: `file:${dbFile}` } : {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** `prisma migrate diff` contra el schema: lanza (exit 2) si hay una sola diferencia. */
function schemaDiff(dbFile: string): string {
  return prisma(
    [
      'migrate',
      'diff',
      // Prisma 7 retiró `--from-url` y `--to-schema-datamodel`: la base sale del datasource de
      // `prisma.config.ts` (que lee `DATABASE_URL`, puesta por `prisma()`) y el schema es `--to-schema`.
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    dbFile,
  );
}

describe('gates contra la CLI real de Prisma (US-275, adaptado a la 7 en US-276)', () => {
  const realRun = (dbFile: string, backupDir: string, migrationsDir = realMigrations) =>
    migrateDatabase({ dbFile, migrationsDir, backupDir });

  it('equivalencia de esquema: base nueva migrada con el aplicador = schema.prisma, sin diferencias', () => {
    const root = tmp();
    const dbFile = join(root, 'nueva.db');
    const res = realRun(dbFile, join(root, 'var'));
    expect(res.applied.length).toBe(readMigrations(realMigrations).length);
    expect(res.applied.length).toBeGreaterThan(30); // guard: la recolección no se quedó vacía
    expect(schemaDiff(dbFile)).toContain('No difference detected');
  }, 120_000);

  it('el gate de equivalencia se pone rojo si la base difiere del schema', () => {
    const root = tmp();
    const dbFile = join(root, 'distinta.db');
    realRun(dbFile, join(root, 'var'));
    const db = new Database(dbFile);
    db.exec('ALTER TABLE "User" ADD COLUMN "columnaDeMas" TEXT');
    db.close();
    expect(() => schemaDiff(dbFile)).toThrow();
  }, 120_000);

  it('base migrada por la CLI de Prisma: el aplicador ve 0 pendientes, checksums idénticos, integridad ok', () => {
    const root = tmp();
    const dbFile = join(root, 'prisma.db');
    prisma(['migrate', 'deploy'], dbFile);

    const res = realRun(dbFile, join(root, 'var'));
    expect(res).toEqual({ applied: [], backupFile: null });

    const disk = readMigrations(realMigrations);
    inspect(dbFile, (db) => {
      const rows = db
        .prepare(
          'SELECT migration_name n, checksum c, finished_at f FROM _prisma_migrations ORDER BY n',
        )
        .all() as { n: string; c: string; f: number | null }[];
      expect(rows.map((r) => [r.n, r.c])).toEqual(disk.map((m) => [m.name, m.checksum]));
      expect(rows.every((r) => r.f !== null)).toBe(true);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    });
    expect(existsSync(join(root, 'var'))).toBe(false);
  }, 120_000);

  it('el historial que escribe el aplicador es idéntico en forma al de Prisma', () => {
    const root = tmp();
    const viaPrisma = join(root, 'prisma.db');
    const viaOurs = join(root, 'ours.db');
    prisma(['migrate', 'deploy'], viaPrisma);
    realRun(viaOurs, join(root, 'var'));

    const shape = (f: string) =>
      inspect(f, (db) => ({
        ddl: (
          db.prepare("SELECT sql FROM sqlite_master WHERE name='_prisma_migrations'").get() as {
            sql: string;
          }
        ).sql,
        rows: db
          .prepare(
            `SELECT migration_name n, checksum c, typeof(finished_at) f, typeof(started_at) s,
                    typeof(logs) l, typeof(rolled_back_at) r, applied_steps_count a
               FROM _prisma_migrations ORDER BY n`,
          )
          .all(),
      }));
    expect(shape(viaOurs)).toEqual(shape(viaPrisma));
  }, 120_000);

  it('Prisma acepta la base migrada por el aplicador: «No pending migrations»', () => {
    const root = tmp();
    const dbFile = join(root, 'ours.db');
    realRun(dbFile, join(root, 'var'));
    expect(prisma(['migrate', 'deploy'], dbFile)).toContain('No pending migrations to apply');
    expect(prisma(['migrate', 'status'], dbFile)).toContain('Database schema is up to date');
  }, 120_000);

  it('historia mixta: el aplicador pone las primeras y Prisma termina el resto', () => {
    const root = tmp();
    const dbFile = join(root, 'mixta.db');
    const all = readMigrations(realMigrations);
    const firstHalf = join(root, 'half');
    mkdirSync(firstHalf);
    for (const m of all.slice(0, 20)) {
      cpSync(join(realMigrations, m.name), join(firstHalf, m.name), { recursive: true });
    }
    expect(realRun(dbFile, join(root, 'var'), firstHalf).applied).toHaveLength(20);

    const out = prisma(['migrate', 'deploy'], dbFile);
    expect(out).toContain('migrations found');
    expect(out).toContain('successfully applied');
    expect(realRun(dbFile, join(root, 'var'))).toEqual({ applied: [], backupFile: null });
    expect(schemaDiff(dbFile)).toContain('No difference detected');
  }, 180_000);

  it('aplicar las migraciones reales tras la mitad hecha por Prisma deja la misma base', () => {
    // El sentido contrario: Prisma hace las 20 primeras (su dir de migraciones es el del
    // schema, así que se acota con un schema temporal) y el aplicador termina.
    const root = tmp();
    const dbFile = join(root, 'inversa.db');
    const all = readMigrations(realMigrations);
    const schemaDir = join(root, 'prisma');
    mkdirSync(join(schemaDir, 'migrations'), { recursive: true });
    cpSync(join(agentRoot, 'prisma', 'schema.prisma'), join(schemaDir, 'schema.prisma'));
    cpSync(
      join(realMigrations, 'migration_lock.toml'),
      join(schemaDir, 'migrations', 'migration_lock.toml'),
    );
    for (const m of all.slice(0, 20)) {
      cpSync(join(realMigrations, m.name), join(schemaDir, 'migrations', m.name), {
        recursive: true,
      });
    }
    // Prisma 7: el directorio de migraciones y la base salen de la CONFIG, no del schema;
    // una config mínima (objeto plano, sin imports) apunta a la media historia.
    const configFile = join(root, 'prisma.half.config.ts');
    writeFileSync(
      configFile,
      `export default ${JSON.stringify({
        schema: join(schemaDir, 'schema.prisma'),
        migrations: { path: join(schemaDir, 'migrations') },
        datasource: { url: `file:${dbFile}` },
      })};\n`,
    );
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', configFile], {
      cwd: agentRoot,
      env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
      stdio: 'ignore',
    });
    expect(names(dbFile)).toHaveLength(20);

    const res = realRun(dbFile, join(root, 'var'));
    expect(res.applied).toHaveLength(all.length - 20);
    expect(res.backupFile).not.toBeNull(); // había base y pendientes: copia previa
    expect(schemaDiff(dbFile)).toContain('No difference detected');
  }, 180_000);
});
