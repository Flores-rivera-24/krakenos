/**
 * Aviso de licencias de las crates de Rust que lleva la ventana de escritorio (`apps/window/src-tauri`).
 * Hermano de `licenses.mjs` (npm): funciones puras + CLI que corre `cargo metadata` en el job de Windows.
 * Uso: node scripts/package/rust-licenses.mjs <dir del Cargo.toml> <salida> [--informe]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PERMITIDAS = new Set([
  'MIT',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Zlib',
  'Unicode-3.0',
  'Unicode-DFS-2016',
  '0BSD',
  'CC0-1.0',
  'BSL-1.0',
  'Unlicense',
  'MPL-2.0',
]);
const COPYLEFT = /^(A|L)?GPL/i;
const FICHERO_LICENCIA = /^(LICEN[CS]E|COPYING|NOTICE)/i;

/** Crates que entran en el binario: aristas normales transitivas desde la raíz (sin build ni dev). */
export function crateDeEjecucion(metadata, raiz) {
  const pkgs = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodos = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const inicio = metadata.packages.find((p) => p.name === raiz);
  if (!inicio) throw new Error(`no hay un paquete raíz «${raiz}» en cargo metadata`);
  const vistos = new Set([inicio.id]);
  const pila = [inicio.id];
  const out = [];
  while (pila.length) {
    for (const d of nodos.get(pila.pop())?.deps ?? []) {
      if (!d.dep_kinds.some((k) => k.kind === null) || vistos.has(d.pkg)) continue;
      vistos.add(d.pkg);
      pila.push(d.pkg);
      const p = pkgs.get(d.pkg);
      out.push({
        name: p.name,
        version: p.version,
        license: p.license ?? null,
        license_file: p.license_file ?? null,
        authors: p.authors ?? [],
        repository: p.repository ?? null,
        dir: dirname(p.manifest_path),
      });
    }
  }
  return out;
}

function tokens(expr) {
  return expr
    .replace(/\//g, ' OR ')
    .replace(/([()])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * ¿Vale la expresión SPDX? `OR` vale si vale una rama; `AND`, si valen todas. Una licencia copyleft
 * que no cubre otra rama es decisión del dueño (congelaría la doble licencia): lanza con el nombre.
 */
export function licenciaPermitida(expr, nombre) {
  const t = tokens(expr);
  let i = 0;
  const copyleft = [];
  const atomo = () => {
    if (t[i] === '(') {
      i++;
      const v = or();
      i++; // ')'
      return v;
    }
    let id = t[i++];
    if (t[i]?.toUpperCase() === 'WITH') {
      i++;
      id += ` WITH ${t[i++]}`;
    }
    if (COPYLEFT.test(id)) copyleft.push(id);
    return PERMITIDAS.has(id);
  };
  const and = () => {
    let v = atomo();
    while (t[i]?.toUpperCase() === 'AND') {
      i++;
      v = atomo() && v;
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (t[i]?.toUpperCase() === 'OR') {
      i++;
      v = and() || v;
    }
    return v;
  };
  const ok = or();
  if (!ok && copyleft.length)
    throw new Error(
      `licencia ${copyleft.join(', ')} (copyleft) en ${nombre}: es decisión del dueño, no se admite sola`,
    );
  return ok;
}

/** Ficheros de licencia de una crate (literal) más el `license_file` declarado. */
export async function textosDeLicencia(dir, licenseFile) {
  const nombres = new Set();
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isFile() && FICHERO_LICENCIA.test(e.name)) nombres.add(e.name);
  }
  if (licenseFile) nombres.add(licenseFile);
  const out = [];
  for (const fichero of [...nombres].sort()) {
    out.push({ fichero, texto: await readFile(join(dir, fichero), 'utf8') });
  }
  return out;
}

/** Aviso ordenado por nombre; un texto idéntico a uno ya impreso se sustituye por una referencia. */
export function avisoRust(crates) {
  const impresos = new Map();
  const orden = [...crates].sort((a, b) =>
    a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1,
  );
  const bloques = orden.map((c) => {
    const id = `${c.name} ${c.version}`;
    let b = `${'='.repeat(72)}\n${id} — ${c.license ?? 'ver fichero de licencia'}\n`;
    if (c.authors?.length) b += `Autores: ${c.authors.join(', ')}\n`;
    if (c.repository) b += `Repositorio: ${c.repository}\n`;
    b += `${'='.repeat(72)}\n`;
    for (const { fichero, texto } of c.textos) {
      const h = createHash('sha256').update(texto).digest('hex');
      const antes = impresos.get(h);
      if (antes) b += `--- ${fichero}: mismo texto que ${antes}\n`;
      else {
        impresos.set(h, `${id} (${fichero})`);
        b += `--- ${fichero}\n${texto.trim()}\n`;
      }
    }
    return b;
  });
  const cabecera =
    'Avisos de licencia de las crates de Rust incluidas en la ventana de escritorio de KrakenOS (Windows).\n';
  return `${cabecera}\n${bloques.join('\n')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const informe = args.includes('--informe');
  const [dir, salida] = args.filter((a) => a !== '--informe');
  if (!dir || !salida)
    throw new Error('uso: rust-licenses.mjs <dir del Cargo.toml> <salida> [--informe]');
  const r = spawnSync(
    'cargo',
    [
      'metadata',
      '--format-version',
      '1',
      '--locked',
      '--filter-platform',
      'x86_64-pc-windows-msvc',
    ],
    { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`cargo metadata falló:\n${r.stderr}`);
  const crates = crateDeEjecucion(JSON.parse(r.stdout), 'krakenos-window');
  const errores = [];
  const porLicencia = new Map();
  const sinTexto = [];
  for (const c of crates) {
    if (!c.license && !c.license_file) {
      errores.push(`${c.name} ${c.version}: sin license ni license_file`);
      continue;
    }
    const lic = c.license ?? `(license_file: ${c.license_file})`;
    porLicencia.set(lic, (porLicencia.get(lic) ?? 0) + 1);
    if (c.license) {
      try {
        if (!licenciaPermitida(c.license, `${c.name} ${c.version}`))
          errores.push(`${c.name} ${c.version}: licencia no permitida (${c.license})`);
      } catch (e) {
        errores.push(e.message);
      }
    }
    c.textos = await textosDeLicencia(c.dir, c.license_file);
    if (!c.textos.length) sinTexto.push(`${c.name} ${c.version}`);
  }
  console.log(`crates en el binario: ${crates.length}`);
  for (const [l, n] of [...porLicencia].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${l}`);
  console.log(
    `MPL: ${
      crates
        .filter((c) => /MPL/.test(c.license ?? ''))
        .map((c) => `${c.name} ${c.version}`)
        .join(', ') || 'ninguna'
    }`,
  );
  console.log(`sin texto de licencia: ${sinTexto.length}`);
  for (const s of sinTexto) console.log(`  - ${s}`);
  // Regla estricta salvo `--informe` (medición previa de crates sin fichero de licencia).
  if (!informe && sinTexto.length)
    errores.push(...sinTexto.map((s) => `${s}: sin ningún texto de licencia`));
  if (errores.length) throw new Error(errores.join('\n'));
  await writeFile(salida, avisoRust(crates));
  console.log(`ok: ${salida} (${crates.length} crates)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
