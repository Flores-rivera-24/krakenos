/**
 * Rehace los enlaces de pnpm cuando `node_modules` cambió de sitio (US-284).
 *
 * En Windows pnpm crea junctions con ruta ABSOLUTA hacia `<origen>\node_modules\.pnpm\…`: tras
 * mover la carpeta (al empaquetar, o cuando el usuario mueve el paquete) quedan rotas. En
 * Linux los enlaces son relativos y sobreviven. Vive en su propio fichero porque el primer
 * arranque del paquete (`first-run.mjs`) también lo importa.
 */
import { lstat, readdir, readlink, stat, symlink, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const SEGMENTO = '/node_modules/.pnpm/';

async function existe(ruta) {
  return stat(ruta).then(
    () => true,
    () => false,
  );
}

/** Enlaces de `<dir>/*` y `<dir>/@scope/*` (sin `.bin` ni `.pnpm`). */
async function enlacesDe(dir) {
  const out = [];
  let nombres;
  try {
    nombres = await readdir(dir);
  } catch {
    return out;
  }
  for (const n of nombres) {
    if (n === '.bin' || n === '.pnpm') continue;
    const ruta = join(dir, n);
    const st = await lstat(ruta);
    if (st.isSymbolicLink()) out.push(ruta);
    else if (n.startsWith('@') && st.isDirectory()) {
      for (const s of await readdir(ruta)) {
        const r = join(ruta, s);
        if ((await lstat(r)).isSymbolicLink()) out.push(r);
      }
    }
  }
  return out;
}

/**
 * @param {string} nodeModulesRoot
 * @returns {Promise<{ relinked: string[], unresolved: string[] }>}
 */
export async function relinkPnpmJunctions(nodeModulesRoot) {
  const pnpm = join(nodeModulesRoot, '.pnpm');
  const candidatos = await enlacesDe(nodeModulesRoot);
  // El hoist (`.pnpm/node_modules/*`) también lleva enlaces; no es un paquete de `.pnpm`.
  candidatos.push(...(await enlacesDe(join(pnpm, 'node_modules'))));
  for (const d of await readdir(pnpm).catch(() => [])) {
    if (d === 'lock.yaml' || d === 'node_modules') continue;
    candidatos.push(...(await enlacesDe(join(pnpm, d, 'node_modules'))));
  }
  const relinked = [];
  const unresolved = [];
  for (const enlace of candidatos) {
    const destino = await readlink(enlace);
    if (await existe(resolve(dirname(enlace), destino))) continue;
    const norm = destino.replace(/\\/g, '/');
    const i = norm.lastIndexOf(SEGMENTO);
    const nuevo = i === -1 ? null : join(pnpm, ...norm.slice(i + SEGMENTO.length).split('/'));
    if (nuevo === null || !(await existe(nuevo))) {
      unresolved.push(enlace);
      continue;
    }
    await unlink(enlace);
    if (process.platform === 'win32') await symlink(nuevo, enlace, 'junction');
    else await symlink(relative(dirname(enlace), nuevo), enlace);
    relinked.push(enlace);
  }
  return { relinked, unresolved };
}
