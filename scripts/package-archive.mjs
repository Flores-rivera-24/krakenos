/**
 * `node scripts/package-archive.mjs <carpeta>`: comprime el paquete (`out/krakenos-<v>-<id>`) en
 * `out/portable/` y escribe la ruta del archivo en stdout. La plataforma sale del sufijo del nombre
 * de la carpeta, no del host.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATAFORMAS = ['win-x64', 'linux-x64', 'linux-arm64'];

/** Plan puro (sin tocar disco): dónde queda el archivo y con qué comando se crea. */
export function archivePlan(dir, { systemRoot = process.env.SystemRoot ?? 'C:\\Windows' } = {}) {
  const nombre = basename(dir);
  const id = PLATAFORMAS.find((p) => nombre.endsWith(`-${p}`));
  if (!id)
    throw new Error(`No reconozco la plataforma de ${nombre}; esperaba ${PLATAFORMAS.join(', ')}`);
  const padre = dirname(dir);
  if (id === 'win-x64') {
    const dest = join(padre, 'portable', `${nombre}.zip`);
    // El bsdtar del sistema: un GNU tar de Git no escribe zip (igual que scripts/package.mjs).
    return {
      dest,
      cmd: `${systemRoot}\\System32\\tar.exe`,
      args: ['-a', '-cf', dest, '-C', padre, nombre],
    };
  }
  const dest = join(padre, 'portable', `${nombre}.tar.gz`);
  // shortcut: GNU tar (flags --owner/--group), solo corre en el runner de Linux; en Windows va bsdtar.
  return { dest, cmd: 'tar', args: ['-czf', dest, '--owner=0', '--group=0', '-C', padre, nombre] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) throw new Error('uso: package-archive.mjs <carpeta>');
  const { dest, cmd, args } = archivePlan(dir);
  mkdirSync(dirname(dest), { recursive: true });
  const r = spawnSync(cmd, args, { stdio: ['ignore', 2, 2] });
  if (r.status !== 0) {
    console.error(`${cmd} salió con ${r.status ?? r.error?.message}`);
    process.exit(r.status ?? 1);
  }
  console.log(dest);
}
