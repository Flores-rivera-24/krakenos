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
 * - `maxEntryKb`: suma de los chunks `index-*` (lo que se descarga al abrir la
 *   app: es lo que manda en el TTI móvil).
 * - `maxChunkKb`: ningún chunk individual (lazy incluido) puede superarlo.
 * - `maxTotalKb`: suma de todo el JS del build.
 * @param {ChunkInfo[]} chunks
 * @param {Budget} budget
 * @returns {string[]}
 */
export function checkBudget(chunks, budget) {
  const violations = [];
  const entryKb = chunks
    .filter((c) => c.name.startsWith('index-'))
    .reduce((sum, c) => sum + c.gzipKb, 0);
  const totalKb = chunks.reduce((sum, c) => sum + c.gzipKb, 0);

  if (entryKb > budget.maxEntryKb) {
    violations.push(
      `La entrada (chunks index-*) pesa ${entryKb.toFixed(1)} kB gzip > presupuesto ${budget.maxEntryKb} kB`,
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

  const top = [...chunks].sort((a, b) => b.gzipKb - a.gzipKb).slice(0, 5);
  const totalKb = chunks.reduce((s, c) => s + c.gzipKb, 0);
  console.log(`Presupuesto de bundle (gzip) — ${chunks.length} chunks, total ${totalKb.toFixed(1)} kB`);
  for (const c of top) console.log(`  ${c.gzipKb.toFixed(1).padStart(7)} kB  ${c.name}`);

  const violations = checkBudget(chunks, budget);
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
