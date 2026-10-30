/**
 * Destino del empaquetado (US-284): qué Node viaja dentro de la carpeta y cómo se
 * llaman su binario y su lanzador según la plataforma.
 *
 * Es una función pura y de tres casos cerrados a propósito: las plataformas que
 * KrakenOS declara instalables (Windows x64, Linux x64 y arm64). Cualquier otra
 * lanza en vez de empaquetar un Node que nadie ha probado.
 */

// Se fija exacta, como la fija la CI: un Node distinto al verificado no se empaqueta.
export const NODE_VERSION = '24.21.0';

const DESTINOS = {
  'win32/x64': { id: 'win-x64', ext: 'zip', nodeBin: 'node/node.exe', launcher: 'krakenos.cmd' },
  'linux/x64': {
    id: 'linux-x64',
    ext: 'tar.xz',
    nodeBin: 'node/bin/node',
    launcher: 'bin/krakenos',
  },
  'linux/arm64': {
    id: 'linux-arm64',
    ext: 'tar.xz',
    nodeBin: 'node/bin/node',
    launcher: 'bin/krakenos',
  },
};

/**
 * @param {string} platform `process.platform`
 * @param {string} arch `process.arch`
 * @returns {{ id: 'win-x64'|'linux-x64'|'linux-arm64', nodeArchive: string, nodeBin: string, launcher: string }}
 */
export function resolveTarget(platform, arch) {
  const d = DESTINOS[`${platform}/${arch}`];
  if (!d) {
    throw new Error(
      `Plataforma sin soporte para empaquetar: ${platform}/${arch} (solo win32/x64, linux/x64 y linux/arm64)`,
    );
  }
  return {
    id: d.id,
    nodeArchive: `node-v${NODE_VERSION}-${d.id}.${d.ext}`,
    nodeBin: d.nodeBin,
    launcher: d.launcher,
  };
}
