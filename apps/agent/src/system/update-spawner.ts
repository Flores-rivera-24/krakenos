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
  };
}
