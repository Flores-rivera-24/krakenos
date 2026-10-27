import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { agentPaths } from '../config/paths.js';
import { resolveDbFile } from './database-url.js';

/**
 * Aplicador de migraciones propio (US-275).
 *
 * Sustituye a `prisma migrate deploy` SIN cambiar el formato: lee las mismas
 * `prisma/migrations/<nombre>/migration.sql` y deja la misma tabla `_prisma_migrations`
 * (mismas columnas, `checksum` = sha256 hex del fichero), así que una base migrada
 * por este aplicador la acepta la CLI de Prisma y viceversa. Lo atan los gates de
 * `test/unit/migrate.test.ts` contra la CLI real.
 *
 * Por qué no es un `BEGIN; migration.sql; COMMIT` a secas: ocho migraciones
 * reconstruyen tablas con `PRAGMA foreign_keys=OFF`, y ese PRAGMA **no hace nada
 * dentro de una transacción**. Por migración: `foreign_keys=OFF` FUERA →
 * `BEGIN IMMEDIATE` → SQL → `foreign_key_check` → fila de historial → `COMMIT` →
 * `foreign_keys=ON`.
 */

/** Código estable del fallo: lo usan los tests y el mensaje de arranque. */
export type MigrationErrorCode =
  | 'CHECKSUM_CHANGED'
  | 'INCOMPLETE'
  | 'UNKNOWN_APPLIED'
  | 'DB_NOT_EMPTY'
  | 'FK_VIOLATION'
  | 'APPLY_FAILED'
  | 'NO_SPACE'
  | 'NO_MIGRATIONS';

export class MigrationError extends Error {
  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    /** Migración implicada, si la hay. */
    readonly migration?: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

/** Fila de `_prisma_migrations` (solo lo que el aplicador necesita leer). */
export interface AppliedMigration {
  name: string;
  checksum: string;
  finishedAt: number | null;
  rolledBackAt: number | null;
}

/** sha256 hex del contenido tal cual está en disco (el algoritmo de Prisma). */
export function checksumOf(sql: string | Buffer): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Lee el `migration.sql` de cada subdirectorio de `dir`, en orden de nombre (el de Prisma). Ignora `migration_lock.toml`. */
export function readMigrations(dir: string): MigrationFile[] {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const out: MigrationFile[] = [];
  for (const name of names) {
    const file = join(dir, name, 'migration.sql');
    if (!existsSync(file)) continue;
    const raw = readFileSync(file);
    out.push({ name, sql: raw.toString('utf8'), checksum: checksumOf(raw) });
  }
  return out;
}

/**
 * Decide qué falta por aplicar. Pura: no toca disco ni base. Lanza si la base y el
 * código no cuentan la misma historia (en ese caso arrancar sería adivinar).
 *
 * Una fila con `rolled_back_at` está resuelta a mano (`prisma migrate resolve
 * --rolled-back`): cuenta como NO aplicada, igual que en Prisma.
 */
export function planMigrations(
  disk: MigrationFile[],
  applied: AppliedMigration[],
): MigrationFile[] {
  const live = applied.filter((a) => a.rolledBackAt === null);

  const incomplete = live.find((a) => a.finishedAt === null);
  if (incomplete) {
    throw new MigrationError(
      'INCOMPLETE',
      `La migración «${incomplete.name}» quedó a medias en una ejecución anterior (sin fecha de fin). ` +
        'No se aplica nada más hasta resolverlo: restaura la copia previa a la migración (var/pre-migrate-*.db) ' +
        'o revisa la base a mano.',
      incomplete.name,
    );
  }

  const byName = new Map(disk.map((m) => [m.name, m]));
  for (const a of live) {
    const file = byName.get(a.name);
    if (!file) {
      throw new MigrationError(
        'UNKNOWN_APPLIED',
        `La base tiene aplicada la migración «${a.name}», que no existe en esta versión de KrakenOS: ` +
          'la base es más nueva que el código (¿se ha vuelto a una versión anterior?). ' +
          'Arranca la versión que la creó o restaura una copia anterior.',
        a.name,
      );
    }
    if (file.checksum !== a.checksum) {
      throw new MigrationError(
        'CHECKSUM_CHANGED',
        `La migración «${a.name}» ya estaba aplicada y su contenido ha cambiado desde entonces ` +
          `(checksum de la base ${a.checksum.slice(0, 12)}…, el del fichero ${file.checksum.slice(0, 12)}…). ` +
          'Una migración aplicada no se edita: crea una nueva.',
        a.name,
      );
    }
  }

  const done = new Set(live.map((a) => a.name));
  return disk.filter((m) => !done.has(m.name));
}

/**
 * Nombre de la primera migración aplicada en `dbFile` que `migrationsDir` no conoce
 * (la base es de una versión más nueva que este código), o `null`. Abre la base en
 * SOLO LECTURA y nunca lanza: un fichero que no es SQLite o sin historial no es
 * «más nuevo» (del resto se ocupa el aplicador al arrancar). Otros desajustes del
 * planificador (checksum, a medias) tampoco se tratan aquí.
 */
export function findUnknownMigration(dbFile: string, migrationsDir: string): string | null {
  let db: Database.Database | undefined;
  try {
    db = new Database(dbFile, { readonly: true, fileMustExist: true });
    planMigrations(readMigrations(migrationsDir), readApplied(db));
    return null;
  } catch (err) {
    return err instanceof MigrationError && err.code === 'UNKNOWN_APPLIED'
      ? (err.migration ?? null)
      : null;
  } finally {
    db?.close();
  }
}

export interface ForeignKeyViolation {
  table: string;
  parent: string;
}

/**
 * Violaciones **nuevas** de claves foráneas: las que superan, por par (tabla, padre),
 * lo que ya había ANTES de la migración. Una huérfana heredada de una versión vieja no
 * puede dejar la casa sin arrancar para siempre; una que la migración acaba de
 * provocar sí. Pura.
 */
export function newViolations(
  before: ForeignKeyViolation[],
  after: ForeignKeyViolation[],
): ForeignKeyViolation[] {
  const key = (v: ForeignKeyViolation): string => `${v.table}\u0000${v.parent}`;
  const budget = new Map<string, number>();
  for (const v of before) budget.set(key(v), (budget.get(key(v)) ?? 0) + 1);
  const fresh: ForeignKeyViolation[] = [];
  for (const v of after) {
    const left = budget.get(key(v)) ?? 0;
    if (left > 0) budget.set(key(v), left - 1);
    else fresh.push(v);
  }
  return fresh;
}

/** Nombre de una copia previa: el ISO con `:`/`.` saneados ordena por fecha como texto. */
export function preMigrateFileName(now: Date): string {
  return `pre-migrate-${now.toISOString().replace(/[:.]/g, '-')}.db`;
}

const PRE_MIGRATE_RE = /^pre-migrate-.+\.db$/;

/** Qué copias previas sobran para quedarse con las `keep` más recientes. Pura. */
export function staleBackups(files: string[], keep: number): string[] {
  const ours = files.filter((f) => PRE_MIGRATE_RE.test(f)).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
}

export interface MigrateOptions {
  /** Fichero SQLite (ya resuelto; ver `resolveDbFile`). */
  dbFile: string;
  /** Directorio `prisma/migrations`. */
  migrationsDir: string;
  /** Dónde va la copia previa (`var/` por defecto en el arranque). */
  backupDir: string;
  /** Copias previas que se conservan (por defecto 3). */
  keepBackups?: number;
  /** Bytes libres en el destino de la copia (inyectable en tests; por defecto `statfs`). */
  freeBytes?: (dir: string) => number;
  log?: (message: string) => void;
  now?: () => Date;
}

export interface MigrateResult {
  /** Nombres aplicados en esta ejecución, en orden. */
  applied: string[];
  /** Copia previa creada (solo si había pendientes y la base ya existía). */
  backupFile: string | null;
}

interface MigrationRow {
  migration_name: string;
  checksum: string;
  finished_at: number | null;
  rolled_back_at: number | null;
}

const CREATE_HISTORY = `CREATE TABLE "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

function readViolations(db: Database.Database): ForeignKeyViolation[] {
  const rows = db.pragma('foreign_key_check') as { table: string; parent: string }[];
  return rows.map((r) => ({ table: r.table, parent: r.parent }));
}

function readApplied(db: Database.Database): AppliedMigration[] {
  const hasHistory = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'")
    .get();
  if (!hasHistory) return [];
  const rows = db
    .prepare(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at, migration_name',
    )
    .all() as MigrationRow[];
  return rows.map((r) => ({
    name: r.migration_name,
    checksum: r.checksum,
    finishedAt: r.finished_at,
    rolledBackAt: r.rolled_back_at,
  }));
}

function hasUserTables(db: Database.Database): boolean {
  return (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name <> '_prisma_migrations' LIMIT 1",
      )
      .get() !== undefined
  );
}

function defaultFreeBytes(dir: string): number {
  const fs = statfsSync(dir);
  return fs.bavail * fs.bsize;
}

/** Copia consistente (`VACUUM INTO`, correcta con WAL) y poda de las antiguas. */
function backupBeforeMigrating(
  db: Database.Database,
  dbFile: string,
  backupDir: string,
  keep: number,
  now: Date,
  freeBytes: (dir: string) => number,
): string {
  // La copia es la base ENTERA (hashes, secretos cifrados, tokens): el directorio nace
  // 0700 y la copia 0600, como el resto de lo que lleva credenciales.
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const dest = join(backupDir, preMigrateFileName(now));

  // Una copia que no cabe se llevaría por delante el disco de una caja desatendida;
  // y migrar sin red de seguridad no se hace en silencio: se niega y se dice qué falta.
  // Con WAL, lo que se copia es el principal + el `-wal` (aún sin volcar al principal).
  const dbBytes =
    statSync(dbFile).size + (existsSync(`${dbFile}-wal`) ? statSync(`${dbFile}-wal`).size : 0);
  const free = freeBytes(backupDir);
  if (free < dbBytes * 1.1) {
    throw new MigrationError(
      'NO_SPACE',
      `No hay espacio para la copia previa a la migración en ${backupDir} ` +
        `(libres ${Math.floor(free / 1048576)} MB, la base ocupa ${Math.ceil(dbBytes / 1048576)} MB). ` +
        'Libera espacio y vuelve a arrancar: no se migra sin copia.',
    );
  }

  // `VACUUM INTO` admite un destino inexistente o VACÍO, pero no fija el modo: se crea
  // antes el fichero vacío en 0600 para que la copia no exista ni un instante con el
  // umask por defecto (aunque el directorio ya existiera más abierto). El `chmod` final
  // cubre el caso de un fichero que ya estuviera ahí (`mode` solo aplica al crear).
  rmSync(dest, { force: true });
  writeFileSync(dest, '', { mode: 0o600 });
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  chmodSync(dest, 0o600);

  for (const old of staleBackups(readdirSync(backupDir), keep)) {
    rmSync(join(backupDir, old), { force: true });
  }
  return dest;
}

function applyOne(db: Database.Database, m: MigrationFile, now: () => Date): void {
  // Fuera de la transacción: dentro, SQLite lo ignora y un DROP TABLE de un padre
  // arrastraría a sus hijos por ON DELETE CASCADE.
  db.pragma('foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const startedAt = now().getTime();
      const before = readViolations(db);

      db.exec(m.sql);
      if (!db.inTransaction) {
        throw new MigrationError(
          'APPLY_FAILED',
          `La migración «${m.name}» cerró la transacción por su cuenta (COMMIT/ROLLBACK en el SQL).`,
          m.name,
        );
      }

      const fresh = newViolations(before, readViolations(db));
      if (fresh.length > 0) {
        const detail = [...new Set(fresh.map((v) => `${v.table} → ${v.parent}`))].join(', ');
        throw new MigrationError(
          'FK_VIOLATION',
          `La migración «${m.name}» deja filas que violan claves foráneas (${detail}); se deshace y la base queda como estaba.`,
          m.name,
        );
      }

      db.prepare(
        `INSERT INTO _prisma_migrations
           (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
      ).run(randomUUID(), m.checksum, now().getTime(), m.name, startedAt);
      db.exec('COMMIT');
    } catch (err) {
      if (db.inTransaction) db.exec('ROLLBACK');
      if (err instanceof MigrationError) throw err;
      throw new MigrationError(
        'APPLY_FAILED',
        `La migración «${m.name}» falló y se deshizo (la base queda como estaba): ${
          err instanceof Error ? err.message : String(err)
        }`,
        m.name,
      );
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Aplica las migraciones pendientes. Síncrono a propósito (better-sqlite3 lo es y se
 * ejecuta antes de abrir Prisma). Idempotente: sin pendientes no toca nada.
 */
export function migrateDatabase(opts: MigrateOptions): MigrateResult {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? ((): Date => new Date());
  const keep = opts.keepBackups ?? 3;

  const disk = readMigrations(opts.migrationsDir);
  if (disk.length === 0) {
    throw new MigrationError('NO_MIGRATIONS', `No hay migraciones en ${opts.migrationsDir}.`);
  }

  const existed = existsSync(opts.dbFile) && statSync(opts.dbFile).size > 0;
  mkdirSync(dirname(opts.dbFile), { recursive: true, mode: 0o700 });
  const db = new Database(opts.dbFile);
  try {
    db.pragma('busy_timeout = 10000');

    const applied = readApplied(db);
    if (applied.length === 0 && hasUserTables(db)) {
      throw new MigrationError(
        'DB_NOT_EMPTY',
        `La base ${opts.dbFile} ya tiene tablas pero ningún historial de migraciones: ` +
          'no es una base de KrakenOS (o se creó sin migrar). No se toca.',
      );
    }

    const pending = planMigrations(disk, applied);
    if (pending.length === 0) return { applied: [], backupFile: null };

    let backupFile: string | null = null;
    if (existed) {
      backupFile = backupBeforeMigrating(
        db,
        opts.dbFile,
        opts.backupDir,
        keep,
        now(),
        opts.freeBytes ?? defaultFreeBytes,
      );
      log(`[migrate] Copia previa a la migración: ${backupFile}`);
    }

    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='_prisma_migrations'").get()) {
      db.exec(CREATE_HISTORY);
    }

    const done: string[] = [];
    for (const m of pending) {
      applyOne(db, m, now);
      done.push(m.name);
      log(`[migrate] Aplicada ${m.name}`);
    }
    return { applied: done, backupFile };
  } finally {
    db.close();
  }
}

/** Directorio de migraciones por defecto: `prisma/migrations` respecto al cwd del agente. */
export function defaultMigrationsDir(): string {
  return agentPaths().migrationsDir;
}

/** Dónde va la copia previa: `KRAKENOS_PRE_MIGRATE_DIR` (Docker lo apunta al volumen) o `var/`. */
export function defaultBackupDir(): string {
  return process.env.KRAKENOS_PRE_MIGRATE_DIR
    ? resolve(process.env.KRAKENOS_PRE_MIGRATE_DIR)
    : agentPaths().varDir;
}

/** Migra la base de `DATABASE_URL` (o `file:./dev.db`, como el resto del agente). */
export function migrateFromEnv(log: (message: string) => void): MigrateResult {
  return migrateDatabase({
    dbFile: resolveDbFile(process.env.DATABASE_URL ?? 'file:./dev.db'),
    migrationsDir: defaultMigrationsDir(),
    backupDir: defaultBackupDir(),
    log,
  });
}
