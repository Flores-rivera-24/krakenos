/**
 * Avisos de licencia de terceros del paquete (US-284): nombre@versión, licencia declarada y
 * el texto de su fichero de licencia, para todo lo que queda en `node_modules/.pnpm` tras la poda.
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FICHERO_LICENCIA = /^(licen[cs]e|copying)(\.[a-z]+)?$/i;

function licenciaDeclarada(pj) {
  const l = pj.license ?? pj.licenses;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map((x) => x?.type ?? String(x)).join(' OR ');
  if (l && typeof l === 'object' && typeof l.type === 'string') return l.type;
  return 'sin declarar';
}

async function paquetesDe(nm) {
  const out = [];
  for (const e of await readdir(nm)) {
    const ruta = join(nm, e);
    const st = await lstat(ruta);
    if (e.startsWith('@') && st.isDirectory()) {
      for (const s of await readdir(ruta)) {
        if ((await lstat(join(ruta, s))).isDirectory()) out.push(join(ruta, s));
      }
    } else if (st.isDirectory() && e !== '.bin') out.push(ruta);
  }
  return out;
}

/**
 * @param {string} nodeModulesRoot
 * @returns {Promise<string>}
 */
export async function collectThirdPartyLicenses(nodeModulesRoot) {
  const pnpm = join(nodeModulesRoot, '.pnpm');
  const vistos = new Map();
  for (const d of await readdir(pnpm)) {
    if (d === 'node_modules' || d === 'lock.yaml') continue;
    const nm = join(pnpm, d, 'node_modules');
    const lista = await paquetesDe(nm).catch(() => []);
    for (const ruta of lista) {
      let pj;
      try {
        pj = JSON.parse(await readFile(join(ruta, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      if (typeof pj.name !== 'string' || typeof pj.version !== 'string') continue;
      const id = `${pj.name}@${pj.version}`;
      if (vistos.has(id)) continue;
      const fichero = (await readdir(ruta)).find((f) => FICHERO_LICENCIA.test(f));
      const texto = fichero ? (await readFile(join(ruta, fichero), 'utf8')).trim() : '';
      vistos.set(id, {
        name: pj.name,
        version: pj.version,
        id,
        licencia: licenciaDeclarada(pj),
        texto,
      });
    }
  }
  const ordenados = [...vistos.values()].sort((a, b) =>
    a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1,
  );
  const cabecera =
    'Avisos de licencia de los componentes de terceros incluidos en este paquete de KrakenOS.\n';
  const bloques = ordenados.map(
    (p) =>
      `${'='.repeat(72)}\n${p.id}\nLicencia: ${p.licencia}\n${'='.repeat(72)}\n` +
      (p.texto ? `${p.texto}\n` : '(el paquete no incluye fichero de licencia)\n'),
  );
  return `${cabecera}\n${bloques.join('\n')}`;
}
