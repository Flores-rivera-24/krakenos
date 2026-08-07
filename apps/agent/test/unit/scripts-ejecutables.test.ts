import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');

/**
 * Todo script `.sh` del repo debe estar marcado como **ejecutable en el índice de
 * git** (modo `100755`), no solo en el disco de quien lo escribió.
 *
 * El bit de ejecución es parte del contenido versionado: un clon limpio recibe
 * exactamente el modo que hay en el índice. `apps/agent/scripts/gen-keys.sh`
 * estaba a `100644`, y `scripts/prod.sh` lo invoca **directamente**
 * (`"$AGENT/scripts/gen-keys.sh"`, no `bash …`) con `set -euo pipefail`: en
 * cualquier clon nuevo `pnpm prod` moría en el paso [2/5] con «Permission
 * denied» antes de generar las claves JWT. No se veía en el repo original
 * porque allí las claves ya existían y ese `if` no llegaba a entrar nunca —el
 * fallo solo aparecía para quien instalaba por primera vez, que es justo a quien
 * no se puede fallar. El README también documenta `./scripts/gen-keys.sh`.
 *
 * Se comprueba contra `git ls-files -s` y no contra el disco a propósito: `chmod`
 * en local no arregla nada si el modo no viaja en el commit.
 */
describe('bit de ejecución de los scripts', () => {
  const entradas = execFileSync('git', ['ls-files', '-s', '*.sh'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((linea) => {
      const [modo, , , ruta] = linea.split(/\s+/);
      return { modo, ruta: ruta ?? '' };
    });

  it('encuentra los scripts del repo (guard: si la recolección se rompe, la lista sale vacía)', () => {
    expect(entradas.length).toBeGreaterThan(4);
  });

  it.each(entradas)('$ruta es ejecutable en el índice de git', ({ modo, ruta }) => {
    expect(modo, `${ruta} está a ${modo}: en un clon limpio no se podrá ejecutar`).toBe('100755');
  });
});
