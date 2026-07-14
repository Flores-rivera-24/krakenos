/**
 * Detección del modo de despliegue (US-190). Distingue **bare-metal/systemd**
 * (el proceso puede reemplazarse desde fuera: `git pull` + `systemctl restart` con
 * healthcheck y rollback) de **Docker** (el contenedor NO puede auto-reemplazarse;
 * la actualización one-click se degrada a mostrar el comando `compose pull`).
 *
 * No había detección previa (el modo era implícito en la configuración). El orden
 * de decisión, con seams inyectables para tests:
 *  1. Override explícito `KRAKENOS_DEPLOY_MODE` (`docker`|`systemd`) — la palabra
 *     final; lo puede fijar el `Dockerfile`/`entrypoint.sh` o el operador.
 *  2. Presencia de `/.dockerenv` (lo crea el runtime de Docker) → `docker`.
 *  3. Por defecto `systemd` (bare-metal / servicio del SO).
 */

import { existsSync } from 'node:fs';
import { DEPLOY_MODES, type DeployMode } from '@krakenos/types';

export interface DeployModeProbe {
  /** Valor de `KRAKENOS_DEPLOY_MODE` (o equivalente). */
  envOverride?: string;
  /** Comprobación de existencia de fichero (inyectable en tests). */
  fileExists?: (path: string) => boolean;
}

export function detectDeployMode(probe: DeployModeProbe = {}): DeployMode {
  const override = (probe.envOverride ?? process.env.KRAKENOS_DEPLOY_MODE ?? '').trim().toLowerCase();
  if ((DEPLOY_MODES as readonly string[]).includes(override)) {
    return override as DeployMode;
  }
  const exists = probe.fileExists ?? existsSync;
  return exists('/.dockerenv') ? 'docker' : 'systemd';
}

/** Comando manual sugerido para actualizar un despliegue Docker (US-190). */
export const DOCKER_UPDATE_COMMAND = 'docker compose pull && docker compose up -d';
