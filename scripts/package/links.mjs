/**
 * Manifiesto de enlaces de pnpm para el instalador de Windows.
 *
 * El bundler NSIS de Tauri copia ficheros pero NO las junctions: `node_modules` llegaba sin ningún
 * enlace de primer nivel y el agente no arrancaba. El empaquetado deja `links.json` (enlace → destino,
 * ambos relativos) y el hook POSTINSTALL ejecuta este fichero con el Node empaquetado para rehacerlos.
 * Uso: `node links.mjs <node_modules> <links.json>`.
 */
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rmdir,
  symlink,
  unlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const aPosix = (p) => p.split(sep).join('/');
const dentro = (raiz, ruta) => {
  const r = relative(raiz, ruta);
  return r !== '' && !r.startsWith('..') && !isAbsolute(r);
};

/** Enlaces bajo `root` (sin bajar por ellos): `[{ link, target }]` relativos, con `/`, ordenados. */
export async function collectLinks(root) {
  const base = await realpath(root);
  const out = [];
  const pila = [base];
  while (pila.length > 0) {
    const dir = pila.pop();
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isSymbolicLink()) {
        out.push({
          link: aPosix(relative(base, ruta)),
          target: aPosix(relative(dirname(ruta), await realpath(ruta))),
        });
      } else if (e.isDirectory()) pila.push(ruta);
    }
  }
  return out.sort((a, b) => (a.link < b.link ? -1 : 1));
}

/** Ruta absoluta del enlace y de su destino; lanza si alguna sale de `base` (el manifiesto lo lee un proceso elevado). */
function resolverEntrada(base, { link, target }) {
  const enlace = resolve(base, link);
  const destino = resolve(dirname(enlace), target);
  if (
    isAbsolute(link) ||
    /^[A-Za-z]:/.test(link) ||
    !dentro(base, enlace) ||
    !dentro(base, destino)
  ) {
    throw new Error(`entrada fuera de la carpeta: ${link} -> ${target}`);
  }
  return { enlace, destino };
}

const infoEnlace = (ruta) => lstat(ruta).catch(() => null);
const real = (ruta) => realpath(ruta).catch(() => null);

/**
 * Crea (como junction) los enlaces que falten. Lanza si una entrada sale de `root`:
 * el manifiesto lo lee un proceso elevado y no debe poder escribir fuera de la carpeta.
 * Al actualizar encima, un enlace que ya existe con OTRO destino (o colgante) se rehace: darlo por bueno
 * dejaría la versión nueva leyendo dependencias de la vieja. Lo que no es un enlace no se toca.
 * @returns {Promise<{ created: number, existing: number, redone: number }>}
 */
export async function applyLinks(root, links) {
  const base = resolve(root);
  let created = 0;
  let existing = 0;
  let redone = 0;
  for (const entrada of links) {
    const { enlace, destino } = resolverEntrada(base, entrada);
    const st = await infoEnlace(enlace);
    if (st) {
      const aqui = st.isSymbolicLink() ? await real(enlace) : undefined;
      if (!st.isSymbolicLink() || (aqui !== null && aqui === (await real(destino)))) {
        existing++;
        continue;
      }
      await quitarEnlace(enlace);
      redone++;
    } else created++;
    await mkdir(dirname(enlace), { recursive: true });
    await symlink(destino, enlace, 'junction');
  }
  return { created, existing, redone };
}

/** Quita el enlace en sí, sin seguirlo (`unlink`; una junction de Windows a veces pide `rmdir`). */
async function quitarEnlace(ruta) {
  try {
    await unlink(ruta);
  } catch {
    await rmdir(ruta);
  }
}

/**
 * Quita los enlaces del manifiesto (desinstalar): solo los que son enlaces, sin seguirlos, para que el
 * borrado recursivo posterior de NSIS no tenga ninguno que pudiera seguir hacia fuera. Lo que ya no existe
 * no es un error.
 * @returns {Promise<{ removed: number }>}
 */
export async function removeLinks(root, links) {
  const base = resolve(root);
  const rutas = links.map((e) => resolverEntrada(base, e).enlace);
  let removed = 0;
  for (const enlace of rutas) {
    if (!(await infoEnlace(enlace))?.isSymbolicLink()) continue;
    await quitarEnlace(enlace);
    removed++;
  }
  return { removed };
}

// import.meta.main (Node >= 24.2): lo ejecuta el instalador; importado desde un test no hace nada.
if (import.meta.main) {
  const [nm, manifiesto] = process.argv.slice(2);
  if (!nm || !manifiesto) {
    console.error('uso: node links.mjs <node_modules> <links.json>');
    process.exit(2);
  }
  const r = await applyLinks(nm, JSON.parse(await readFile(manifiesto, 'utf8')));
  console.log(`enlaces rehechos: ${r.created}; ya existían: ${r.existing}`);
}
