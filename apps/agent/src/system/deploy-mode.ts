/**
 * Detección del modo de despliegue (US-190, ampliada en US-280). Distingue
 * **systemd** (instalación con `install.sh`: el proceso puede reemplazarse desde fuera,
 * `git pull` + `systemctl restart` con healthcheck y rollback) de los modos donde el
 * agente NO puede auto-reemplazarse: **docker**, **windows-service** y **package** (`.deb`).
 *
 * El orden de decisión, con seams inyectables para tests:
 *  1. Override explícito `KRAKENOS_DEPLOY_MODE` (cualquiera de `DEPLOY_MODES`) — la
 *     palabra final; lo fija el `Dockerfile`, el paquete `.deb` o el operador. Única vía
 *     por la que se llega a `package`: no hay nada fiable que lo distinga en disco.
 *     Salvedad: en Windows `systemd` no puede existir, así que ese override se ignora.
 *  2. Windows (`win32`) → `windows-service`. **Nunca `systemd`**: un servicio de Windows
 *     que se creyera systemd intentaría `systemctl restart` y fallaría a medio actualizar.
 *  3. Presencia de `/.dockerenv` (lo crea el runtime de Docker) → `docker`.
 *  4. Por defecto `systemd` (bare-metal / servicio del SO).
 *
 * Solo `systemd` se auto-actualiza (`canAutoUpdate`); los demás devuelven el camino manual
 * que tengan (Docker: `compose pull`) o, si todavía no hay ninguno, lo declaran.
 */

import { existsSync } from 'node:fs';
import { DEPLOY_MODES, type DeployMode } from '@krakenos/types';

export interface DeployModeProbe {
  /** Valor de `KRAKENOS_DEPLOY_MODE` (o equivalente). */
  envOverride?: string;
  /** Comprobación de existencia de fichero (inyectable en tests). */
  fileExists?: (path: string) => boolean;
  /** Plataforma (inyectable en tests; por defecto `process.platform`). */
  platform?: NodeJS.Platform;
}

export function detectDeployMode(probe: DeployModeProbe = {}): DeployMode {
  const platform = probe.platform ?? process.platform;
  const override = (probe.envOverride ?? process.env.KRAKENOS_DEPLOY_MODE ?? '')
    .trim()
    .toLowerCase();
  if ((DEPLOY_MODES as readonly string[]).includes(override)) {
    if (!(platform === 'win32' && override === 'systemd')) return override as DeployMode;
  }
  if (platform === 'win32') return 'windows-service';
  const exists = probe.fileExists ?? existsSync;
  return exists('/.dockerenv') ? 'docker' : 'systemd';
}

/** ¿Puede el agente lanzar su propia actualización? Solo en `systemd`. */
export function canAutoUpdate(mode: DeployMode): boolean {
  return mode === 'systemd';
}

/** Comando manual sugerido para actualizar un despliegue Docker (US-190). */
export const DOCKER_UPDATE_COMMAND = 'docker compose pull && docker compose up -d';
