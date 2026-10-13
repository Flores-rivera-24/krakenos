// Presupuesto de rendimiento móvil (US-193): cotas de tamaño gzip sobre el
// build de la web. Corre en CI tras `pnpm build` y FALLA si se excede — una
// dependencia pesada nueva o un chunk sin code-splitting no entra en verde.
// La lógica es pura (`checkBudget`) y se testea con regresiones simuladas.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** @typedef {{ name: string, gzipKb: number }} ChunkInfo */
/** @typedef {{ maxEntryKb: number, maxChunkKb: number, maxTotalKb: number }} Budget */

/**
 * Evalúa los chunks contra el presupuesto. Puro: devuelve la lista de
 * violaciones (vacía = dentro de presupuesto).
 * - `maxEntryKb`: la CARGA INICIAL real (lo que manda en el TTI móvil). Si se
 *   pasa `initialNames` (los chunks que `index.html` carga: el módulo de entrada
 *   más los `modulepreload`), es la suma de esos. Sin él, la suma de los
 *   `index-*` (comportamiento anterior). Con rolldown (vite 8) la entrada `index-*`
 *   es pequeña y el grueso viaja en chunks precargados, así que medir solo
 *   `index-*` dejaba el gate ciego.
 * - `maxChunkKb`: ningún chunk individual (lazy incluido) puede superarlo.
 * - `maxTotalKb`: suma de todo el JS del build.
 * @param {ChunkInfo[]} chunks
 * @param {Budget} budget
 * @param {string[]} [initialNames] nombres de los chunks de la carga inicial
 * @returns {string[]}
 */
export function checkBudget(chunks, budget, initialNames) {
  const violations = [];
  let entryChunks;
  if (initialNames) {
    const byName = new Map(chunks.map((c) => [c.name, c]));
    const missing = initialNames.filter((n) => !byName.has(n));
    // Falla cerrado: un chunk que index.html carga y no existe en dist/ no se puede medir.
    if (missing.length > 0) {
      violations.push(`index.html carga chunks que no están en dist/assets: ${missing.join(', ')}`);
    }
    entryChunks = initialNames.map((n) => byName.get(n)).filter(Boolean);
    if (!entryChunks.some((c) => c.name.startsWith('index-'))) {
      violations.push('index.html no carga ningún chunk de entrada index-*: no se puede medir');
    }
  } else {
    entryChunks = chunks.filter((c) => c.name.startsWith('index-'));
  }
  const entryKb = entryChunks.reduce((sum, c) => sum + c.gzipKb, 0);
  const totalKb = chunks.reduce((sum, c) => sum + c.gzipKb, 0);

  if (entryKb > budget.maxEntryKb) {
    violations.push(
      `La carga inicial pesa ${entryKb.toFixed(1)} kB gzip > presupuesto ${budget.maxEntryKb} kB (suma ${entryChunks.length} chunks: ${entryChunks.map((c) => `${c.name} ${c.gzipKb.toFixed(1)}`).join(', ')})`,
    );
  }
  for (const chunk of chunks) {
    if (chunk.gzipKb > budget.maxChunkKb) {
      violations.push(
        `El chunk ${chunk.name} pesa ${chunk.gzipKb.toFixed(1)} kB gzip > presupuesto ${budget.maxChunkKb} kB (¿falta code-splitting?)`,
      );
    }
  }
  if (totalKb > budget.maxTotalKb) {
    violations.push(
      `El JS total pesa ${totalKb.toFixed(1)} kB gzip > presupuesto ${budget.maxTotalKb} kB`,
    );
  }
  return violations;
}

/**
 * Chunks JS de la carga inicial según `index.html`: los `<script type="module">`
 * y los `<link rel="modulepreload">` que apuntan a `/assets/*.js`. Puro.
 * @param {string} html
 * @returns {string[]}
 */
export function initialChunkNames(html) {
  const names = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const attr = (k) => new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1];
    const isScript = /^<script/i.test(tag) && attr('type') === 'module';
    const isPreload = /^<link/i.test(tag) && attr('rel') === 'modulepreload';
    if (!isScript && !isPreload) continue;
    const m = /\/assets\/([^/"?#]+\.js)$/.exec(attr(isScript ? 'src' : 'href') ?? '');
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/** Lee los chunks JS del build y calcula su tamaño gzip. */
export function readChunks(assetsDir) {
  return readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js'))
    .map((name) => ({
      name,
      gzipKb: gzipSync(readFileSync(join(assetsDir, name))).length / 1024,
    }));
}

// ---- CLI ----
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const budget = JSON.parse(readFileSync(join(here, '../bundle-budget.json'), 'utf8'));
  let chunks;
  try {
    chunks = readChunks(join(here, '../dist/assets'));
  } catch {
    console.error('No hay build en dist/ — ejecuta `pnpm build` antes del presupuesto.');
    process.exit(1);
  }

  let initialNames;
  try {
    initialNames = initialChunkNames(readFileSync(join(here, '../dist/index.html'), 'utf8'));
  } catch {
    console.error('No se puede leer dist/index.html — sin él no se mide la carga inicial.');
    process.exit(1);
  }

  const top = [...chunks].sort((a, b) => b.gzipKb - a.gzipKb).slice(0, 5);
  const totalKb = chunks.reduce((s, c) => s + c.gzipKb, 0);
  console.log(
    `Presupuesto de bundle (gzip) — ${chunks.length} chunks, total ${totalKb.toFixed(1)} kB`,
  );
  for (const c of top) console.log(`  ${c.gzipKb.toFixed(1).padStart(7)} kB  ${c.name}`);

  const initial = chunks.filter((c) => initialNames.includes(c.name));
  const initialKb = initial.reduce((s, c) => s + c.gzipKb, 0);
  console.log(
    `Carga inicial: ${initialKb.toFixed(1)} kB (suma ${initial.length} chunks: ${initial.map((c) => `${c.name} ${c.gzipKb.toFixed(1)}`).join(', ')})`,
  );

  const violations = checkBudget(chunks, budget, initialNames);
  if (violations.length > 0) {
    console.error('\n✗ Presupuesto excedido:');
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      '\nSi el aumento es deliberado, ajusta apps/web/bundle-budget.json en el mismo PR y justifícalo.',
    );
    process.exit(1);
  }
  console.log('✓ Dentro de presupuesto.');
}
