/**
 * Implementación real del `UpdateRunner` (US-190) para despliegues **bare-metal /
 * systemd**: mapea cada paso de la orquestación a comandos del sistema
 * (`git`, `pnpm`, `prisma`, `systemctl`) y a un healthcheck HTTP local.
 *
 * `exec` es **inyectable** (patrón `privileged/runner.ts`): en tests se sustituye
 * por un mock, así el mapeo paso→comando se verifica sin ejecutar nada real. La
 * ejecución con hardware/servicio real se verifica en el despliegue (US-86); aquí
 * no hay `git`/`systemctl` ni privilegios.
 *
 * Rollback: el `backup` copia la DB viva a `<db>.pre-update` y guarda el commit
 * actual; `rollback` restaura ambos y reinicia. Es una red de seguridad LOCAL para
 * revertir una migración/versión rota — complementa (no sustituye) el backup
 * cifrado exportable de US-103.
 */

import { copyFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { EXTRA_DEPS_FILE, parseExtraDeps } from './extra-deps.js';
import type { UpdateRunner } from './update-orchestrator.js';

const execFileAsync = promisify(execFile);

export interface UpdateExecResult {
  stdout: string;
  stderr: string;
}

/** Ejecuta un binario sin shell (evita inyección). Lanza si el código ≠ 0. */
export type UpdateExec = (file: string, args: string[]) => Promise<UpdateExecResult>;

/**
 * Snapshot consistente de la base viva. Con **WAL** (US-228) una copia del
 * fichero principal a secas pierde lo que aún vive en el `-wal`, así que el
 * snapshot va por `VACUUM INTO` (misma técnica que el backup cifrado de US-103).
 */
export type DbSnapshot = (dbFile: string, destFile: string) => Promise<void>;

/**
 * `VACUUM INTO` con Prisma (import perezoso: este proceso no levanta el agente).
 * Si falla por cualquier motivo, degrada a copia del fichero avisando — un
 * snapshot imperfecto es mejor que quedarse sin red de seguridad.
 */
function createDefaultSnapshot(warn: (message: string) => void): DbSnapshot {
  return async (dbFile, destFile) => {
    // `VACUUM INTO` exige que el destino NO exista.
    await rm(destFile, { force: true });
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
      try {
        await prisma.$executeRawUnsafe(`VACUUM INTO '${destFile.replace(/'/g, "''")}'`);
      } finally {
        await prisma.$disconnect();
      }
    } catch (err) {
      warn(
        `[update] VACUUM INTO falló (${err instanceof Error ? err.message : 'error'}); ` +
          'el snapshot se hace copiando el fichero (puede perder lo que quede en el WAL)',
      );
      await rm(destFile, { force: true });
      await copyFile(dbFile, destFile);
    }
  };
}

const defaultExec: UpdateExec = async (file, args) => {
  // Sin shell, timeout amplio (build+install pueden tardar), buffer generoso.
  const { stdout, stderr } = await execFileAsync(file, args, {
    timeout: 20 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
};

export interface ProcessUpdateRunnerOptions {
  /** Raíz del repositorio git a actualizar. */
  repoDir: string;
  /** Nombre de la unidad systemd a reiniciar (p. ej. `krakenos`). */
  serviceName: string;
  /** URL de readiness a sondear tras el reinicio (`/health/ready`). */
  healthUrl: string;
  /** Ruta del fichero SQLite vivo (para el snapshot de rollback). */
  dbFile: string;
  /** Directorio del paquete del agente (por defecto `<repoDir>/apps/agent`). */
  agentDir?: string;
  /** Exec inyectable (tests). */
  exec?: UpdateExec;
  /** Fetch de healthcheck inyectable (tests). */
  fetchFn?: (url: string) => Promise<{ ok: boolean }>;
  /** Espera inyectable entre reintentos de healthcheck (tests → 0). */
  sleep?: (ms: number) => Promise<void>;
  /** Usa `sudo -n` para `systemctl` (por defecto sí; ver docs/updates.md). */
  useSudo?: boolean;
  /** Snapshot de la DB inyectable (por defecto `VACUUM INTO` con fallback). */
  dbSnapshot?: DbSnapshot;
  /** Manifiesto de deps opcionales (por defecto `<agentDir>/data/extra-deps.json`). */
  extraDepsFile?: string;
  /** Canal de avisos del actualizador (por defecto stderr → journald). */
  warn?: (message: string) => void;
}

const HEALTH_RETRIES = 10;
const HEALTH_INTERVAL_MS = 3000;

export class ProcessUpdateRunner implements UpdateRunner {
  private readonly exec: UpdateExec;
  private readonly fetchFn: (url: string) => Promise<{ ok: boolean }>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly useSudo: boolean;
  private readonly agentDir: string;
  private readonly extraDepsFile: string;
  private readonly warn: (message: string) => void;
  private readonly snapshot: DbSnapshot;
  /** Commit al que revertir (capturado en `backup`). */
  private previousRef: string | null = null;
  /** Etiqueta git objetivo (`v<version>`, fijada en `fetch`). */
  private targetTag = '';

  constructor(private readonly opts: ProcessUpdateRunnerOptions) {
    this.exec = opts.exec ?? defaultExec;
    this.fetchFn = opts.fetchFn ?? ((url) => fetch(url).then((r) => ({ ok: r.ok })));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.useSudo = opts.useSudo ?? true;
    this.agentDir = opts.agentDir ?? resolve(opts.repoDir, 'apps/agent');
    this.extraDepsFile = opts.extraDepsFile ?? resolve(this.agentDir, EXTRA_DEPS_FILE);
    this.warn = opts.warn ?? ((message) => process.stderr.write(`${message}\n`));
    this.snapshot = opts.dbSnapshot ?? createDefaultSnapshot(this.warn);
  }

  private git(...args: string[]): Promise<UpdateExecResult> {
    return this.exec('git', ['-C', this.opts.repoDir, ...args]);
  }

  private systemctl(...args: string[]): Promise<UpdateExecResult> {
    return this.useSudo
      ? this.exec('sudo', ['-n', 'systemctl', ...args])
      : this.exec('systemctl', args);
  }

  private get snapshotFile(): string {
    return `${this.opts.dbFile}.pre-update`;
  }

  async backup(): Promise<void> {
    // Snapshot consistente de la DB viva + commit actual, para poder revertir ambos
    // si algo falla. Con WAL (US-228) la copia del fichero a secas se dejaría atrás
    // lo que aún no se ha checkpointeado: de ahí `VACUUM INTO`.
    await this.snapshot(this.opts.dbFile, this.snapshotFile);
    const { stdout } = await this.git('rev-parse', 'HEAD');
    this.previousRef = stdout.trim();
  }

  /**
   * Reinstala las deps opcionales que `pnpm install --frozen-lockfile` acaba de
   * podar (AUD3-22). **No es fatal**: si fallara se avisa y la actualización sigue.
   * Hacerlo fatal convertiría un paquete abandonado en el registro en un update que
   * se revierte para siempre, sin salida para el usuario.
   */
  private async restoreExtraDeps(): Promise<void> {
    let deps: string[] = [];
    try {
      deps = parseExtraDeps(await readFile(this.extraDepsFile, 'utf8'));
    } catch {
      return; // sin manifiesto (instalación sin --with-deps): nada que hacer
    }
    if (deps.length === 0) return;
    try {
      await this.exec('pnpm', ['--dir', this.agentDir, 'add', ...deps]);
    } catch (err) {
      this.warn(
        `[update] no se pudieron reinstalar las dependencias de integraciones ` +
          `(${deps.join(', ')}): ${err instanceof Error ? err.message : 'error'}. ` +
          `Instálalas a mano con «pnpm add ${deps.join(' ')}» en ${this.agentDir}, ` +
          `o edita ${this.extraDepsFile} si alguna ya no existe.`,
      );
    }
  }

  async fetch(targetVersion: string): Promise<void> {
    this.targetTag = `v${targetVersion}`;
    await this.git('fetch', '--tags', '--force');
    // Verifica que la etiqueta existe antes de tocar nada (falla temprano si no).
    await this.git('rev-parse', '--verify', `refs/tags/${this.targetTag}`);
  }

  async apply(): Promise<void> {
    // `fetch` ya validó que la etiqueta existe; aquí sí cambiamos el árbol de trabajo.
    await this.git('checkout', '--force', this.targetTag);
    await this.exec('pnpm', ['install', '--frozen-lockfile', '--dir', this.opts.repoDir]);
    await this.exec('pnpm', ['--dir', this.opts.repoDir, 'build']);
    // El `--frozen-lockfile` de arriba acaba de podar las deps opcionales que el
    // usuario instaló a mano (node-ssh, mqtt, ws…): devolverlas es parte de aplicar.
    await this.restoreExtraDeps();
  }

  async migrate(): Promise<void> {
    await this.exec('pnpm', ['--dir', this.opts.repoDir, 'exec', 'prisma', 'migrate', 'deploy']);
  }

  async restart(): Promise<void> {
    await this.systemctl('restart', this.opts.serviceName);
  }

  async healthcheck(): Promise<boolean> {
    for (let i = 0; i < HEALTH_RETRIES; i++) {
      try {
        const res = await this.fetchFn(this.opts.healthUrl);
        if (res.ok) return true;
      } catch {
        // aún reiniciando
      }
      await this.sleep(HEALTH_INTERVAL_MS);
    }
    return false;
  }

  /**
   * Revierte a la versión previa. El orden importa: **parar → restaurar → arrancar**.
   * Antes se restauraba la DB con el agente vivo y luego se reiniciaba (US-232):
   * sobrescribir el fichero SQLite bajo un proceso que lo tiene abierto es la receta
   * para corromperlo, y con WAL además convivían dos verdades a la vez.
   */
  async rollback(): Promise<void> {
    await this.systemctl('stop', this.opts.serviceName);
    if (this.previousRef) {
      await this.git('checkout', '--force', this.previousRef);
      await this.exec('pnpm', ['install', '--frozen-lockfile', '--dir', this.opts.repoDir]);
      await this.exec('pnpm', ['--dir', this.opts.repoDir, 'build']);
      await this.restoreExtraDeps();
    }
    // Restaura la DB previa (deshace una migración destructiva).
    await copyFile(this.snapshotFile, this.opts.dbFile);
    // Y descarta el WAL/SHM de la versión nueva: pertenecen a la base que acabamos
    // de sustituir, no a la restaurada (US-228 dejó WAL activo por defecto).
    await rm(`${this.opts.dbFile}-wal`, { force: true });
    await rm(`${this.opts.dbFile}-shm`, { force: true });
    await this.systemctl('start', this.opts.serviceName);
  }
}
