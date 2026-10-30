/**
 * Poda y guardián del paquete autocontenido (US-284).
 *
 * Tres operaciones independientes sobre el `node_modules` que sale de `pnpm deploy --prod`:
 * quitar lo que Prisma trae y SQLite no usa, quitar de `.pnpm/` lo que nadie enlaza, y
 * comprobar al final que no viajó nada que no deba salir de esta máquina.
 */
import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const OTRAS_BASES = /postgresql|mysql|sqlserver|cockroachdb/;
// El cliente generado carga exactamente este fichero: si no está, Prisma cambió de forma y
// esta poda ya no sabe qué borra.
const WASM_SQLITE = 'query_compiler_fast_bg.sqlite.wasm-base64.mjs';

async function tamano(ruta) {
  const st = await lstat(ruta);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of await readdir(ruta)) total += await tamano(join(ruta, e));
  return total;
}

async function existe(ruta) {
  return lstat(ruta).then(
    () => true,
    () => false,
  );
}

/**
 * Borra la CLI `prisma` y los compiladores WASM de las bases que no son SQLite.
 * Falla cerrado si no queda el WASM de SQLite.
 * @param {string} root `node_modules` de la carpeta desplegada
 * @returns {Promise<{ removed: string[], freedBytes: number }>}
 */
export async function pruneNodeModules(root) {
  const removed = [];
  let freedBytes = 0;
  const quitar = async (ruta) => {
    freedBytes += await tamano(ruta).catch(() => 0);
    await rm(ruta, { recursive: true, force: true });
    removed.push(relative(root, ruta));
  };

  const pnpm = join(root, '.pnpm');
  const dirsPnpm = (await existe(pnpm)) ? await readdir(pnpm) : [];

  // CLI de Prisma: el enlace de primer nivel y su directorio en .pnpm.
  if (await existe(join(root, 'prisma'))) await quitar(join(root, 'prisma'));
  for (const d of dirsPnpm) if (/^prisma@/.test(d)) await quitar(join(pnpm, d));

  let sqlite = false;
  for (const d of dirsPnpm) {
    if (!d.startsWith('@prisma+client@')) continue;
    const runtime = join(pnpm, d, 'node_modules', '@prisma', 'client', 'runtime');
    if (!(await existe(runtime))) continue;
    for (const f of await readdir(runtime)) {
      if (OTRAS_BASES.test(f)) await quitar(join(runtime, f));
      else if (f === WASM_SQLITE) sqlite = true;
    }
  }
  if (!sqlite) {
    throw new Error(
      `No encuentro ${WASM_SQLITE} en @prisma/client/runtime: Prisma cambió de forma y la poda ya no sabe qué conservar`,
    );
  }
  return { removed, freedBytes };
}

/**
 * Directorio de `.pnpm/` al que apunta un enlace, o null si no apunta ahí o está colgando.
 */
async function destinoEnPnpm(enlace, pnpmReal) {
  let real;
  try {
    real = await realpath(enlace);
  } catch {
    return null;
  }
  const rel = relative(pnpmReal, real);
  if (rel === '' || rel.startsWith('..')) return null;
  return rel.split(sep)[0] ?? null;
}

/** Entradas de un `node_modules` (resolviendo `@scope/*`) como rutas completas. */
async function entradas(nm) {
  const out = [];
  if (!(await existe(nm))) return out;
  for (const e of await readdir(nm)) {
    if (e === '.bin' || e === '.pnpm') continue;
    const ruta = join(nm, e);
    if (e.startsWith('@') && (await lstat(ruta)).isDirectory()) {
      for (const s of await readdir(ruta)) out.push(join(ruta, s));
    } else out.push(ruta);
  }
  return out;
}

/**
 * Borra de `.pnpm/` lo que no se alcanza siguiendo los enlaces desde `node_modules/*`.
 * @param {string} nodeModulesRoot
 * @returns {Promise<{ removed: string[] }>}
 */
export async function pruneUnreachable(nodeModulesRoot) {
  const pnpm = join(nodeModulesRoot, '.pnpm');
  const pnpmReal = await realpath(pnpm);
  const alcanzados = new Set();
  const pendientes = [];
  const visitar = async (enlaces) => {
    for (const e of enlaces) {
      if (!(await lstat(e)).isSymbolicLink()) continue;
      const d = await destinoEnPnpm(e, pnpmReal);
      if (d && d !== 'node_modules' && !alcanzados.has(d)) {
        alcanzados.add(d);
        pendientes.push(d);
      }
    }
  };
  await visitar(await entradas(nodeModulesRoot));
  while (pendientes.length > 0) {
    const d = /** @type {string} */ (pendientes.pop());
    await visitar(await entradas(join(pnpm, d, 'node_modules')));
  }
  const removed = [];
  for (const d of (await readdir(pnpm)).sort()) {
    if (d === 'node_modules' || d === 'lock.yaml' || alcanzados.has(d)) continue;
    await rm(join(pnpm, d), { recursive: true, force: true });
    removed.push(d);
  }
  return { removed };
}

/**
 * Recorre la carpeta final y lanza nombrando la ruta si viajó algo que no debe: claves,
 * `.env`, bases de datos o el código fuente y los tests del agente.
 * @param {string} pkgDir
 * @returns {Promise<void>}
 */
export async function assertNoSecrets(pkgDir) {
  const agent = join(pkgDir, 'app', 'agent');
  const encontrados = [];
  const pila = [pkgDir];
  while (pila.length > 0) {
    const dir = /** @type {string} */ (pila.pop());
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      const delAgente = dir === agent;
      const prohibidoDir = e.isDirectory() && delAgente && ['keys', 'src', 'test'].includes(e.name);
      const prohibidoFichero =
        !e.isDirectory() &&
        (e.name.endsWith('.pem') ||
          e.name === 'secretbox.key' ||
          e.name === '.env' ||
          e.name.endsWith('.db'));
      if (prohibidoDir || prohibidoFichero) encontrados.push(relative(pkgDir, ruta));
      else if (e.isDirectory()) pila.push(ruta);
    }
  }
  if (encontrados.length > 0) {
    throw new Error(
      `El paquete contiene lo que no debe salir de esta máquina: ${encontrados.sort().join(', ')}`,
    );
  }
}
