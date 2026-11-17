/** Partes puras del paquete de Arch (US-294): versión de pacman y el `PKGBUILD`. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLANTILLA = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packaging',
  'linux',
  'arch',
  'PKGBUILD.in',
);

/**
 * semver → pacman, que no admite `-` en `pkgver`: `0.1.0-rc.1` → `0.1.0rc1`. pacman ordena la
 * prerelease ANTES de la estable (`vercmp 0.1.0rc1 0.1.0` = -1), igual que semver.
 */
export function archVersion(pkgVersion) {
  const m = /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.]+))?$/.exec(pkgVersion);
  if (!m) throw new Error(`Versión no válida para pacman: ${pkgVersion}`);
  return m[1] + (m[2] ?? '').replace(/\./g, '');
}

/**
 * @param {{ version: string, pkgrel: number, sha256: string }} o `version` ya pasada por `archVersion`;
 *   `sha256` es la suma de `root.tar`, el árbol que arma `package-arch.mjs`
 */
export function renderPkgbuild({ version, pkgrel, sha256 }) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`sha256 no válida: ${sha256}`);
  return readFileSync(PLANTILLA, 'utf8')
    .replace('@VERSION@', version)
    .replace('@PKGREL@', String(pkgrel))
    .replace('@SHA256@', sha256);
}
