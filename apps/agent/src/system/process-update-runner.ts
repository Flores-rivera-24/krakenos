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

import { copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { UpdateRunner } from './update-orchestrator.js';

const execFileAsync = promisify(execFile);

export interface UpdateExecResult {
  stdout: string;
  stderr: string;
}

/** Ejecuta un binario sin shell (evita inyección). Lanza si el código ≠ 0. */
export type UpdateExec = (file: string, args: string[]) => Promise<UpdateExecResult>;

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
  /** Exec inyectable (tests). */
  exec?: UpdateExec;
  /** Fetch de healthcheck inyectable (tests). */
  fetchFn?: (url: string) => Promise<{ ok: boolean }>;
  /** Espera inyectable entre reintentos de healthcheck (tests → 0). */
  sleep?: (ms: number) => Promise<void>;
  /** Usa `sudo -n` para `systemctl` (por defecto sí; ver docs/updates.md). */
  useSudo?: boolean;
}

const HEALTH_RETRIES = 10;
const HEALTH_INTERVAL_MS = 3000;

export class ProcessUpdateRunner implements UpdateRunner {
  private readonly exec: UpdateExec;
  private readonly fetchFn: (url: string) => Promise<{ ok: boolean }>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly useSudo: boolean;
  /** Commit al que revertir (capturado en `backup`). */
  private previousRef: string | null = null;
  /** Etiqueta git objetivo (`v<version>`, fijada en `fetch`). */
  private targetTag = '';

  constructor(private readonly opts: ProcessUpdateRunnerOptions) {
    this.exec = opts.exec ?? defaultExec;
    this.fetchFn = opts.fetchFn ?? ((url) => fetch(url).then((r) => ({ ok: r.ok })));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.useSudo = opts.useSudo ?? true;
  }

  private git(...args: string[]): Promise<UpdateExecResult> {
    return this.exec('git', ['-C', this.opts.repoDir, ...args]);
  }

  private systemctl(...args: string[]): Promise<UpdateExecResult> {
    return this.useSudo
      ? this.exec('sudo', ['-n', 'systemctl', ...args])
      : this.exec('systemctl', args);
  }

  async backup(): Promise<void> {
    // Copia la DB viva (SQLite en un solo fichero) y captura el commit actual, para
    // poder revertir ambos si algo falla.
    await copyFile(this.opts.dbFile, `${this.opts.dbFile}.pre-update`);
    const { stdout } = await this.git('rev-parse', 'HEAD');
    this.previousRef = stdout.trim();
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

  async rollback(): Promise<void> {
    if (this.previousRef) {
      await this.git('checkout', '--force', this.previousRef);
      await this.exec('pnpm', ['install', '--frozen-lockfile', '--dir', this.opts.repoDir]);
      await this.exec('pnpm', ['--dir', this.opts.repoDir, 'build']);
    }
    // Restaura la DB previa (deshace una migración destructiva).
    await copyFile(`${this.opts.dbFile}.pre-update`, this.opts.dbFile);
    await this.systemctl('restart', this.opts.serviceName);
  }
}
