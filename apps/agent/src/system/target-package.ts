/**
 * Lee el `package.json` de la etiqueta `v<version>` del repo local, sin tocar el
 * árbol de trabajo (`git show`). Lo usa el plan de actualización para anticipar que
 * una versión exige un Node más nuevo.
 *
 * Solo ve etiquetas que el repo YA tiene: no hace `fetch` (un `GET` del plan no
 * debe mutar nada ni salir a la red). Si la etiqueta no está, devuelve `null` y la
 * comprobación definitiva la hace el actualizador, que sí descarga antes.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Solo caracteres de una versión: la cadena acaba como argumento de `git`. */
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;

export type TargetPackageReader = (version: string) => Promise<string | null>;

export function createGitPackageReader(repoDir: string): TargetPackageReader {
  const cache = new Map<string, string>();
  return async (version) => {
    if (!SAFE_VERSION.test(version)) return null;
    const hit = cache.get(version);
    if (hit !== undefined) return hit;
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['-C', repoDir, 'show', `v${version}:package.json`],
        { timeout: 5000, maxBuffer: 1024 * 1024 },
      );
      const text = stdout.toString();
      // Solo se cachea un acierto: una etiqueta que aún no estaba puede llegar luego.
      cache.set(version, text);
      return text;
    } catch {
      return null;
    }
  };
}
