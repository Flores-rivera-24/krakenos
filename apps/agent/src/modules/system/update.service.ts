/**
 * Servicio de actualización one-click con rollback (US-190).
 *
 * Reparte responsabilidades para que TODO sea testeable sin ejecutar una
 * actualización real:
 *  - `getPlan()` combina la comprobación de releases (US-116) + el modo de
 *    despliegue + la ventana de mantenimiento + el resultado de la última
 *    actualización (leído de `var/update-result.json`).
 *  - `apply()` valida (hay actualización, dentro de ventana, no hay otra en curso)
 *    y **lanza el proceso actualizador aparte** (spawner inyectable), que corre el
 *    orquestador (`orchestrateUpdate`) sobreviviendo al reinicio del servicio.
 *
 * En **Docker** el contenedor no puede auto-reemplazarse: `apply()` no lanza nada y
 * devuelve el comando manual (`docker compose pull …`). Honesto (AUD-25).
 *
 * El traspaso servicio→actualizador es por ficheros en `var/` (mismo patrón que el
 * restore de US-104): un `lock` marca "en curso" y `update-result.json` guarda el
 * resultado, que sobrevive al reinicio para mostrarse al volver.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { agentPaths } from '../../config/paths.js';
import type {
  ApplyUpdateResponse,
  UpdateBlockedCode,
  DeployMode,
  UpdatePlan,
  UpdateResult,
} from '@krakenos/types';
import { canAutoUpdate, DOCKER_UPDATE_COMMAND } from '../../system/deploy-mode.js';
import { isWithinWindow, parseMaintenanceWindow } from '../../system/maintenance-window.js';
import {
  isLockStale,
  parseLock,
  processAlive,
  serializeLock,
  type UpdateLock,
} from '../../system/update-lock.js';
import {
  checkNodeRequirement,
  NODE_TOO_OLD,
  readEnginesNode,
} from '../../system/node-requirement.js';
import type { UpdateChecker } from '../../system/update-check.js';

/**
 * Lanza el proceso actualizador para la versión `targetVersion` (detached) y
 * devuelve su PID, que se guarda en el lock para poder detectar un actualizador
 * muerto (US-232). Un spawner que no pueda informarlo devuelve `undefined`.
 */
export type UpdateSpawner = (
  targetVersion: string,
) => number | undefined | Promise<number | undefined>;

export interface UpdateServiceOptions {
  current: string;
  mode: DeployMode;
  checker: UpdateChecker;
  /** Lee el ajuste `updateMaintenanceWindow` (inyectable; evita acoplar a prisma). */
  readMaintenanceWindow: () => Promise<string>;
  /** Lanza el proceso actualizador. En Docker no se usa. */
  spawn: UpdateSpawner;
  /** Directorio de traspaso (por defecto `var/`). */
  varDir?: string;
  now?: () => Date;
  /**
   * Lee el `package.json` del tag de `version` desde el repo local, o `null` si no
   * se puede (tag aún sin descargar, sin git…). Con él `getPlan()` anticipa que la
   * versión exige un Node más nuevo; sin él, lo decide el actualizador en su `fetch`.
   */
  readTargetPackageJson?: (version: string) => Promise<string | null>;
  /** Versión de Node en ejecución (por defecto `process.version`; tests). */
  nodeVersion?: string;
  /** ¿Vive ese PID? Inyectable para tests; por defecto `kill(pid, 0)`. */
  isProcessAlive?: (pid: number) => boolean;
}

export class UpdateService {
  private readonly lockFile: string;
  private readonly resultFile: string;
  private readonly now: () => Date;
  private readonly isProcessAlive: (pid: number) => boolean;

  constructor(private readonly opts: UpdateServiceOptions) {
    const varDir = opts.varDir ?? agentPaths().varDir;
    this.lockFile = resolve(varDir, 'update.lock');
    this.resultFile = resolve(varDir, 'update-result.json');
    this.now = opts.now ?? (() => new Date());
    this.isProcessAlive = opts.isProcessAlive ?? processAlive;
  }

  /**
   * Lock vivo, o `null` si no hay ninguno o el que hay está caduco (US-232): el
   * actualizador murió (era lo que pasaba en cada `systemctl restart`) o lleva
   * más del TTL. Un lock caduco no bloquea nada.
   */
  private async activeLock(): Promise<UpdateLock | null> {
    if (!existsSync(this.lockFile)) return null;
    let lock: UpdateLock | null = null;
    try {
      lock = parseLock(await readFile(this.lockFile, 'utf8'));
    } catch {
      lock = null;
    }
    const stale = isLockStale(lock, {
      isProcessAlive: this.isProcessAlive,
      now: () => this.now().getTime(),
    });
    return stale ? null : lock;
  }

  /**
   * Libera el lock a petición del admin: el caso que no cubre la caducidad
   * automática es un actualizador **vivo pero atascado** (p. ej. `pnpm install`
   * esperando a una red que no vuelve). Devuelve `false` si no había nada que
   * cancelar. No mata el proceso: si sigue vivo terminará y escribirá su
   * resultado; lo que se recupera es la capacidad de volver a intentarlo.
   */
  async cancel(): Promise<boolean> {
    if (!existsSync(this.lockFile)) return false;
    await rm(this.lockFile, { force: true });
    return true;
  }

  private get canSelfUpdate(): boolean {
    return canAutoUpdate(this.opts.mode);
  }

  /** Lee el resultado de la última actualización (parseo defensivo, patrón US-63). */
  private async readLastResult(): Promise<UpdateResult | null> {
    try {
      if (!existsSync(this.resultFile)) return null;
      const raw = await readFile(this.resultFile, 'utf8');
      const parsed = JSON.parse(raw) as UpdateResult;
      // Validación mínima de forma; una fila corrupta no debe tumbar el plan.
      if (parsed && Array.isArray(parsed.steps) && typeof parsed.ok === 'boolean') {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** ¿Se puede aplicar `version` con el Node actual? Desconocido → no bloquea. */
  private async nodeBlock(
    version: string | null,
  ): Promise<{ reason: UpdateBlockedCode; required: string; message: string } | null> {
    if (!version || !this.opts.readTargetPackageJson) return null;
    let raw: string | null = null;
    try {
      raw = await this.opts.readTargetPackageJson(version);
    } catch {
      return null;
    }
    if (!raw) return null;
    const check = checkNodeRequirement(
      readEnginesNode(raw),
      this.opts.nodeVersion ?? process.version,
    );
    return check.ok
      ? null
      : { reason: NODE_TOO_OLD, required: check.required, message: check.message };
  }

  async getPlan(): Promise<UpdatePlan> {
    const status = await this.opts.checker.check();
    const windowRaw = await this.opts.readMaintenanceWindow();
    const window = parseMaintenanceWindow(windowRaw);
    const lock = await this.activeLock();
    const block = status.updateAvailable ? await this.nodeBlock(status.latest) : null;
    return {
      enabled: status.enabled,
      current: status.current,
      latest: status.latest,
      updateAvailable: status.updateAvailable,
      mode: this.opts.mode,
      canSelfUpdate: this.canSelfUpdate,
      dockerCommand: this.opts.mode === 'docker' ? DOCKER_UPDATE_COMMAND : null,
      inProgress: lock !== null,
      inProgressSince: lock?.startedAt ?? null,
      maintenanceWindow: window ? windowRaw.trim() : null,
      lastResult: await this.readLastResult(),
      blockedReason: block?.reason ?? null,
      requiredNode: block?.required ?? null,
    };
  }

  /**
   * Lanza la actualización. `force` salta la comprobación de ventana (para un admin
   * que quiere actualizar ya). Nunca lanza excepción: siempre devuelve el porqué.
   */
  async apply(force = false): Promise<ApplyUpdateResponse> {
    const mode = this.opts.mode;

    if (mode === 'docker') {
      return {
        started: false,
        mode,
        message:
          'En Docker el contenedor no puede auto-reemplazarse. Actualiza con el comando indicado.',
        dockerCommand: DOCKER_UPDATE_COMMAND,
      };
    }
    if (!canAutoUpdate(mode)) {
      // `windows-service` y `package` (US-280): aún no hay camino de actualización
      // propio (ni comando manual que dar), así que se dice tal cual en vez de fingir uno.
      return {
        started: false,
        mode,
        message: 'Este modo de instalación todavía no se actualiza desde aquí.',
      };
    }

    const status = await this.opts.checker.check();
    if (!status.enabled) {
      return {
        started: false,
        mode,
        message: 'La comprobación de actualizaciones está desactivada.',
      };
    }
    if (!status.updateAvailable || !status.latest) {
      return { started: false, mode, message: 'Ya estás en la última versión.' };
    }
    const block = await this.nodeBlock(status.latest);
    if (block) return { started: false, mode, message: block.message };
    // Solo bloquea un lock VIVO: uno huérfano (el actualizador murió en su propio
    // reinicio, AUD3-20) se pisa en vez de dejar la función inservible.
    if (await this.activeLock()) {
      return { started: false, mode, message: 'Ya hay una actualización en curso.' };
    }

    const window = parseMaintenanceWindow(await this.opts.readMaintenanceWindow());
    if (window && !force && !isWithinWindow(window, this.now())) {
      return {
        started: false,
        mode,
        message: 'Fuera de la ventana de mantenimiento configurada.',
      };
    }

    // Marca "en curso" ANTES de lanzar (el actualizador lo borra al terminar). Así
    // dos clics seguidos no lanzan dos procesos. El PID se rellena en cuanto el
    // spawner lo devuelve, para que un actualizador muerto se detecte enseguida.
    await mkdir(dirname(this.lockFile), { recursive: true });
    const startedAt = this.now().toISOString();
    await writeFile(
      this.lockFile,
      serializeLock({ version: status.latest, pid: 0, startedAt }),
      'utf8',
    );
    try {
      const pid = await this.opts.spawn(status.latest);
      if (typeof pid === 'number' && pid > 0) {
        await writeFile(
          this.lockFile,
          serializeLock({ version: status.latest, pid, startedAt }),
          'utf8',
        );
      }
    } catch (err) {
      await rm(this.lockFile, { force: true });
      return {
        started: false,
        mode,
        message: `No se pudo lanzar la actualización: ${err instanceof Error ? err.message : 'error'}`,
      };
    }

    return { started: true, mode, message: `Actualizando a la versión ${status.latest}…` };
  }
}
