/**
 * Spawner real del proceso actualizador (US-190). Lanza `dist/update-runner.js
 * <version>` **detached**, de modo que sobreviva al reinicio del propio agente que
 * provoca la actualización. Se inyecta en `UpdateService`; en tests se sustituye
 * por un doble que solo registra la versión.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { UpdateSpawner } from '../modules/system/update.service.js';

/**
 * Construye el spawner que ejecuta el actualizador como proceso independiente. La
 * salida se descarta (`ignore`) y se hace `unref()` para no atar el ciclo de vida
 * del agente al del actualizador (el agente será reiniciado por el propio proceso).
 *
 * ⚠️ **`detached` NO saca el proceso del cgroup de la unidad systemd** (solo le da
 * su propia sesión). Con el `KillMode` por defecto (`control-group`), el
 * `systemctl restart` del paso 5 mataba al actualizador **a mitad de su propia
 * secuencia** → nunca había healthcheck ni rollback y el lock quedaba huérfano
 * (AUD3-20). Por eso la unidad de servicio lleva **`KillMode=process`**
 * (`krakenos.service.example` y el unit que escribe `scripts/install.sh`): con
 * ella systemd solo señaliza al proceso principal y el actualizador sobrevive.
 * Si alguien despliega con una unidad propia sin esa línea, la actualización
 * one-click volverá a morirse en el reinicio.
 */
export function createUpdateSpawner(): UpdateSpawner {
  return (targetVersion: string) => {
    // Hermano de este módulo en el bundle: dist/update-runner.js.
    const runnerPath = fileURLToPath(new URL('../update-runner.js', import.meta.url));
    const child = spawn(process.execPath, [runnerPath, targetVersion], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    // El PID va al lock: así un actualizador muerto se detecta y no deja la
    // función bloqueada para siempre (US-232 / AUD3-20).
    return child.pid;
  };
}
