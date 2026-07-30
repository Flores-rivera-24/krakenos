import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * US-231 (AUD3-33) — **la imagen de GHCR podía romperse sin que ningún build en
 * verde lo detectara.**
 *
 * `docker.yml` solo se dispara con cambios en `Dockerfile`/`docker/`/`compose`/
 * `.dockerignore`, **no** con `apps/**`. Así que un patrón de `.dockerignore` que
 * se trague un directorio FUENTE no lo caza nadie: `build-test` no construye la
 * imagen y `docker.yml` no se ejecuta. El fallo aparecería ya publicado.
 *
 * Meter `apps/**` en los `paths` de `docker.yml` haría construir una imagen en
 * cada PR (lento y caro para el riesgo real). En su lugar, este test —que corre en
 * `build-test`, o sea en **todos** los PRs— comprueba lo que de verdad importa:
 * que ningún patrón excluya un directorio de código que la imagen necesita.
 *
 * El caso concreto que ya mordió una vez (ver gotcha de `CLAUDE.md`): un patrón
 * de doble asterisco sobre «coverage», sin anclar, se traga los tres directorios
 * FUENTE con ese nombre — `apps/agent/src/coverage`,
 * `apps/agent/src/modules/coverage` y `apps/web/src/components/coverage`.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const patterns = readFileSync(`${ROOT}.dockerignore`, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'));

/**
 * Traduce un patrón de `.dockerignore` a regex. Docker usa sintaxis Go
 * `filepath.Match` extendida con `**`; aquí basta con cubrir lo que se usa de
 * verdad (`**`, `*`, `?` y rutas literales) porque el test es un guardarraíl, no
 * una reimplementación del motor de Docker.
 */
function toRegExp(pattern: string): RegExp {
  const ESCAPAR = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
  let body = '';
  // Una sola pasada, sin marcadores intermedios: sustituir por fases obliga a
  // inventar placeholders que luego hay que volver a buscar, y cualquier cadena
  // elegida puede aparecer en el patron real.
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*' && pattern[i + 2] === '/') {
      body += '(?:.*/)?'; // `**/` = cero o mas segmentos de ruta
      i += 2;
    } else if (c === '*' && pattern[i + 1] === '*') {
      body += '.*';
      i += 1;
    } else if (c === '*') {
      body += '[^/]*'; // un `*` no cruza separadores
    } else if (c === '?') {
      body += '[^/]';
    } else {
      body += ESCAPAR.has(c) ? `\\${c}` : c;
    }
  }
  // Docker excluye la ruta que casa **y todo lo que cuelga de ella**.
  return new RegExp(`^${body}(?:/.*)?$`);
}

/** Rutas de código que la imagen NECESITA para construir y arrancar. */
const RUTAS_QUE_DEBEN_ENTRAR = [
  'apps/agent/src',
  'apps/agent/src/index.ts',
  'apps/agent/src/server.ts',
  'apps/web/src',
  'packages/types/src',
  'packages/types/src/index.ts',
  // Los tres directorios FUENTE llamados «coverage» (el gotcha histórico).
  'apps/agent/src/coverage',
  'apps/agent/src/coverage/propagation.ts',
  'apps/agent/src/modules/coverage',
  'apps/agent/src/modules/coverage/coverage.routes.ts',
  'apps/web/src/components/coverage',
  'apps/web/src/components/coverage/FloorPlanStage.tsx',
  // Ficheros de build imprescindibles.
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'apps/agent/prisma/schema.prisma',
  'apps/agent/scripts/gen-keys.sh',
  'docker/entrypoint.sh',
];

/** Rutas que NO deben acabar nunca en la imagen (secretos, estado, docs internos). */
const RUTAS_QUE_DEBEN_QUEDARSE_FUERA = [
  'apps/agent/keys',
  'apps/agent/keys/jwt-private.pem',
  'apps/agent/data',
  'apps/agent/data/cameras.json',
  'apps/agent/.env',
  'apps/agent/prisma/dev.db',
  'node_modules',
  'apps/web/node_modules',
  'apps/agent/dist',
  '.git',
  'CLAUDE.md',
  'BACKLOG.md',
  'apps/agent/coverage',
  'apps/web/coverage',
];

const excluye = (ruta: string) => patterns.filter((p) => toRegExp(p).test(ruta));

describe('.dockerignore no puede tragarse código fuente (US-231 · AUD3-33)', () => {
  it('el fichero se leyó y tiene patrones (guard de recolección)', () => {
    // Sin esto, un `.dockerignore` movido o vacío haría pasar todo el test.
    expect(patterns.length).toBeGreaterThan(10);
  });

  it.each(RUTAS_QUE_DEBEN_ENTRAR)('deja entrar %s', (ruta) => {
    expect({ ruta, excluidaPor: excluye(ruta) }).toEqual({ ruta, excluidaPor: [] });
  });

  it.each(RUTAS_QUE_DEBEN_QUEDARSE_FUERA)('deja fuera %s', (ruta) => {
    expect(excluye(ruta).length).toBeGreaterThan(0);
  });

  it('las reglas de «coverage» siguen ANCLADAS, nunca con comodín', () => {
    // Es la forma exacta del fallo: `**/coverage` o `coverage/` a secas casarían
    // con los tres directorios fuente de arriba.
    const sospechosas = patterns.filter((p) => /coverage/.test(p) && !p.startsWith('apps/'));
    expect(sospechosas).toEqual([]);
  });
});
