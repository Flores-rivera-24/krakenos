/**
 * Deps opcionales de integraciones que sobreviven a una actualización (US-232 /
 * AUD3-22).
 *
 * `node-ssh`, `mqtt`, `net-snmp`, `ws`, `tuyapi` y `@matter/main` **no están en
 * `package.json`** a propósito (CI con lockfile congelado) y se cargan con import
 * perezoso: cada guía manda instalarlas a mano en el servidor. El problema es que
 * el actualizador hace `git checkout` + `pnpm install --frozen-lockfile`, que
 * **poda** justo esas deps → el usuario perdía su router SSH o su zigbee2mqtt en
 * cada update, sin ningún mensaje.
 *
 * La solución es un manifiesto en `data/` (untracked, se conserva entre updates)
 * que el instalador escribe con `--with-deps` y el actualizador vuelve a aplicar
 * tras el `apply`.
 *
 * Módulo **puro**: parseo defensivo (patrón US-63) + validación de nombres. Los
 * nombres van a la **argv de `pnpm add`**: aunque `execFile` no usa shell (no hay
 * inyección de shell posible), un nombre que empiece por `-` se interpretaría como
 * bandera de pnpm, así que se filtran.
 */

/** Nombre de fichero del manifiesto, relativo al directorio del agente. */
export const EXTRA_DEPS_FILE = 'data/extra-deps.json';

/** Tope de paquetes: el manifiesto es una lista corta, no un package.json. */
export const MAX_EXTRA_DEPS = 32;

/**
 * Nombre de paquete npm válido: `nombre` o `@scope/nombre`, minúsculas, sin
 * rutas ni banderas. No se admite especificar versión (`pkg@1.2.3`): la versión
 * la resuelve `pnpm add`, y aceptarla abriría la puerta a `pkg@file:/…`.
 */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function isValidPackageName(name: string): boolean {
  return name.length <= 128 && PACKAGE_NAME.test(name);
}

/**
 * Lee el manifiesto. Nunca lanza: un fichero corrupto, ausente o con nombres
 * inválidos devuelve la lista vacía (mejor no reinstalar nada que reventar una
 * actualización por un fichero mal escrito a mano).
 */
export function parseExtraDeps(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  // Admite `["a","b"]` y `{"deps":["a","b"]}` (por si el manifiesto crece).
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { deps?: unknown })?.deps)
      ? (parsed as { deps: unknown[] }).deps
      : [];
  const clean: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!isValidPackageName(name) || clean.includes(name)) continue;
    clean.push(name);
    if (clean.length >= MAX_EXTRA_DEPS) break;
  }
  return clean;
}
