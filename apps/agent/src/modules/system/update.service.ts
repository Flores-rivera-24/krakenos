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
import type {
  ApplyUpdateResponse,
  DeployMode,
  UpdatePlan,
  UpdateResult,
} from '@krakenos/types';
import { DOCKER_UPDATE_COMMAND } from '../../system/deploy-mode.js';
import { isWithinWindow, parseMaintenanceWindow } from '../../system/maintenance-window.js';
import type { UpdateChecker } from '../../system/update-check.js';

/** Lanza el proceso actualizador para la versión `targetVersion` (detached). */
export type UpdateSpawner = (targetVersion: string) => void | Promise<void>;

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
}

export class UpdateService {
  private readonly lockFile: string;
  private readonly resultFile: string;
  private readonly now: () => Date;

  constructor(private readonly opts: UpdateServiceOptions) {
    const varDir = opts.varDir ?? resolve('var');
    this.lockFile = resolve(varDir, 'update.lock');
    this.resultFile = resolve(varDir, 'update-result.json');
    this.now = opts.now ?? (() => new Date());
  }

  private get canSelfUpdate(): boolean {
    return this.opts.mode === 'systemd';
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

  async getPlan(): Promise<UpdatePlan> {
    const status = await this.opts.checker.check();
    const windowRaw = await this.opts.readMaintenanceWindow();
    const window = parseMaintenanceWindow(windowRaw);
    return {
      enabled: status.enabled,
      current: status.current,
      latest: status.latest,
      updateAvailable: status.updateAvailable,
      mode: this.opts.mode,
      canSelfUpdate: this.canSelfUpdate,
      dockerCommand: this.opts.mode === 'docker' ? DOCKER_UPDATE_COMMAND : null,
      inProgress: existsSync(this.lockFile),
      maintenanceWindow: window ? windowRaw.trim() : null,
      lastResult: await this.readLastResult(),
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

    const status = await this.opts.checker.check();
    if (!status.enabled) {
      return { started: false, mode, message: 'La comprobación de actualizaciones está desactivada.' };
    }
    if (!status.updateAvailable || !status.latest) {
      return { started: false, mode, message: 'Ya estás en la última versión.' };
    }
    if (existsSync(this.lockFile)) {
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
    // dos clics seguidos no lanzan dos procesos.
    await mkdir(dirname(this.lockFile), { recursive: true });
    await writeFile(this.lockFile, `${status.latest}\n${this.now().toISOString()}\n`, 'utf8');
    try {
      await this.opts.spawn(status.latest);
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
