/** Partes puras del .deb (US-287): arquitectura, versión y el fichero `control`. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLANTILLA = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packaging',
  'linux',
  'deb',
  'control.in',
);

const ARQUITECTURAS = { 'linux-x64': 'amd64', 'linux-arm64': 'arm64' };

/** @param {string} target id de `resolveTarget` */
export function debArch(target) {
  const a = ARQUITECTURAS[target];
  if (!a) throw new Error(`Sin paquete .deb para ${target} (solo linux-x64 y linux-arm64)`);
  return a;
}

/** semver → Debian: `0.1.0-rc.1` → `0.1.0~rc.1` (la prerelease ordena ANTES de la estable). */
export function debVersion(pkgVersion) {
  return pkgVersion.replace('-', '~');
}

export function debFileName(version, arch) {
  return `krakenos_${version}_${arch}.deb`;
}

export function renderControl({ version, arch, installedSizeKb }) {
  return readFileSync(PLANTILLA, 'utf8')
    .replace('@VERSION@', version)
    .replace('@ARCH@', arch)
    .replace('@SIZE@', String(installedSizeKb));
}
