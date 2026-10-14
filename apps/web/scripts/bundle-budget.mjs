// Presupuesto de rendimiento móvil (US-193): cotas de tamaño gzip sobre el
// build de la web. Corre en CI tras `pnpm build` y FALLA si se excede — una
// dependencia pesada nueva o un chunk sin code-splitting no entra en verde.
// La lógica es pura (`checkBudget`, `routeWeights`, `checkRoutes`) y se testea con
// regresiones simuladas.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** @typedef {{ name: string, gzipKb: number }} ChunkInfo */
/** @typedef {{ maxInitialKb: number, maxRouteKb: number, maxChunkKb: number }} Budget */
/** @typedef {{ file: string, imports?: string[], dynamicImports?: string[] }} ManifestEntry */
/** @typedef {Record<string, ManifestEntry>} Manifest */
/** @typedef {{ route: string, ownKb: number, totalKb: number, chunks: string[] }} RouteWeight */

/**
 * Evalúa los chunks contra el presupuesto. Puro: devuelve la lista de
 * violaciones (vacía = dentro de presupuesto).
 * - `maxInitialKb`: la CARGA INICIAL real (lo que manda en el TTI móvil): la suma
 *   de los chunks que `index.html` carga (`initialNames`: el módulo de entrada más
 *   los `modulepreload`). Con rolldown la entrada `index-*` es pequeña y el grueso
 *   viaja en chunks precargados, así que medir solo `index-*` dejaba el gate ciego.
 *   Sin `initialNames` no se puede medir y falla cerrado.
 * - `maxChunkKb`: ningún chunk individual (lazy incluido) puede superarlo.
 * El peso por ruta lo evalúa `checkRoutes`; el total emitido ya no es un gate.
 * @param {ChunkInfo[]} chunks
 * @param {Budget} budget
 * @param {string[]} [initialNames] nombres de los chunks de la carga inicial
 * @returns {string[]}
 */
export function checkBudget(chunks, budget, initialNames) {
  const violations = [];
  if (!initialNames) {
    return ['No se conoce la carga inicial (falta index.html): no se puede medir'];
  }
  const byName = new Map(chunks.map((c) => [c.name, c]));
  const missing = initialNames.filter((n) => !byName.has(n));
  // Falla cerrado: un chunk que index.html carga y no existe en dist/ no se puede medir.
  if (missing.length > 0) {
    violations.push(`index.html carga chunks que no están en dist/assets: ${missing.join(', ')}`);
  }
  const entryChunks = initialNames.map((n) => byName.get(n)).filter(Boolean);
  if (!entryChunks.some((c) => c.name.startsWith('index-'))) {
    violations.push('index.html no carga ningún chunk de entrada index-*: no se puede medir');
  }
  const initialKb = entryChunks.reduce((sum, c) => sum + c.gzipKb, 0);

  if (initialKb > budget.maxInitialKb) {
    violations.push(
      `La carga inicial pesa ${initialKb.toFixed(1)} kB gzip > presupuesto ${budget.maxInitialKb} kB (suma ${entryChunks.length} chunks: ${entryChunks.map((c) => `${c.name} ${c.gzipKb.toFixed(1)}`).join(', ')})`,
    );
  }
  for (const chunk of chunks) {
    if (chunk.gzipKb > budget.maxChunkKb) {
      violations.push(
        `El chunk ${chunk.name} pesa ${chunk.gzipKb.toFixed(1)} kB gzip > presupuesto ${budget.maxChunkKb} kB (¿falta code-splitting?)`,
      );
    }
  }
  return violations;
}

/**
 * Páginas de la app según `App.tsx`: cada `lazy(() => import('@/pages/X'))`. La
 * convención es la propia declaración de rutas, así que una página nueva entra en
 * el gate sin tocar una lista a mano. Puro.
 * @param {string} appSource
 * @returns {string[]} nombres de página (`DashboardPage`, …) sin repetir
 */
export function pageNames(appSource) {
  const names = [];
  for (const m of appSource.matchAll(/import\(\s*['"]@\/pages\/(\w+)['"]\s*\)/g)) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

const baseName = (file) => file.replace(/^.*\//, '');

/**
 * Chunks que trae una entrada del manifest por imports ESTÁTICOS (transitivos),
 * entrada incluida. Los `dynamicImports` no entran: son carga perezosa que otra
 * navegación decide. Devuelve nombres de fichero. Puro.
 * @param {Manifest} manifest
 * @param {string} key
 * @returns {string[]}
 */
export function staticClosure(manifest, key) {
  const seen = new Set();
  const files = [];
  const visit = (k) => {
    if (seen.has(k)) return;
    seen.add(k);
    const e = manifest[k];
    if (!e) throw new Error(`El manifest no tiene la entrada ${k}`);
    files.push(baseName(e.file));
    for (const i of e.imports ?? []) visit(i);
  };
  visit(key);
  return files;
}

/**
 * Peso por ruta: la carga inicial más lo que trae la página al navegar a ella
 * (su chunk y sus imports estáticos que NO estén ya en la inicial, sin contar
 * nada dos veces). `extras` son entradas del manifest que se cargan en runtime
 * tras iniciar sesión (p. ej. el cliente de socket.io, que la fachada de
 * `lib/socket.ts` importa con `import()`): cuentan en toda ruta que no sea
 * `publicPages`. Falla cerrado (lanza) si una ruta o un extra no está en el
 * manifest o un chunk no tiene tamaño. Puro.
 * @param {{ manifest: Manifest, chunks: ChunkInfo[], initialNames: string[], pages: string[], publicPages?: string[], extras?: string[] }} input
 * @returns {RouteWeight[]}
 */
export function routeWeights({
  manifest,
  chunks,
  initialNames,
  pages,
  publicPages = [],
  extras = [],
}) {
  const size = new Map(chunks.map((c) => [c.name, c.gzipKb]));
  const kb = (n) => {
    const v = size.get(n);
    if (v === undefined) throw new Error(`El chunk ${n} del manifest no está en dist/assets`);
    return v;
  };
  const initial = new Set(initialNames);
  const initialKb = [...initial].reduce((s, n) => s + kb(n), 0);
  return pages.map((page) => {
    const key = `src/pages/${page}.tsx`;
    if (!manifest[key]) throw new Error(`La ruta ${page} no está en el manifest (${key})`);
    const keys = [key, ...(publicPages.includes(page) ? [] : extras)];
    const own = new Set();
    for (const k of keys) {
      for (const n of staticClosure(manifest, k)) if (!initial.has(n)) own.add(n);
    }
    const ownKb = [...own].reduce((s, n) => s + kb(n), 0);
    return { route: page, ownKb, totalKb: initialKb + ownKb, chunks: [...own] };
  });
}

/**
 * Evalúa las rutas contra `maxRouteKb` y exige un mínimo de rutas medidas (si la
 * recolección se rompe, la lista saldría vacía y el gate pasaría en verde).
 * `expectedPages` es lo que `App.tsx` declara: se mide TODO lo declarado.
 * @param {RouteWeight[]} weights
 * @param {{ maxRouteKb: number }} budget
 * @param {{ expectedPages: number, minPages?: number }} opts
 * @returns {string[]}
 */
export function checkRoutes(weights, budget, { expectedPages, minPages = 15 }) {
  const violations = [];
  if (weights.length < minPages || weights.length < expectedPages) {
    violations.push(
      `Se midieron ${weights.length} rutas y se esperaban al menos ${Math.max(minPages, expectedPages)}: la recolección de rutas está rota`,
    );
  }
  for (const w of weights) {
    if (w.totalKb > budget.maxRouteKb) {
      violations.push(
        `La ruta ${w.route} pesa ${w.totalKb.toFixed(1)} kB gzip (inicial + ${w.ownKb.toFixed(1)}) > presupuesto ${budget.maxRouteKb} kB (${w.chunks.join(', ')})`,
      );
    }
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

  const manifestPath = join(here, '../dist/.vite/manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    console.error('No se puede leer dist/.vite/manifest.json — ¿falta build.manifest en vite?');
    process.exit(1);
  }
  let appSource;
  try {
    appSource = readFileSync(join(here, '../src/App.tsx'), 'utf8');
  } catch {
    console.error('No se puede leer src/App.tsx — sin él no se sabe qué rutas medir.');
    process.exit(1);
  }

  const top = [...chunks].sort((a, b) => b.gzipKb - a.gzipKb).slice(0, 5);
  const totalKb = chunks.reduce((s, c) => s + c.gzipKb, 0);
  console.log(
    `Presupuesto de bundle (gzip) — ${chunks.length} chunks, total emitido ${totalKb.toFixed(1)} kB (informativo)`,
  );
  for (const c of top) console.log(`  ${c.gzipKb.toFixed(1).padStart(7)} kB  ${c.name}`);

  const initial = chunks.filter((c) => initialNames.includes(c.name));
  const initialKb = initial.reduce((s, c) => s + c.gzipKb, 0);
  console.log(
    `Carga inicial: ${initialKb.toFixed(1)} kB (suma ${initial.length} chunks: ${initial.map((c) => `${c.name} ${c.gzipKb.toFixed(1)}`).join(', ')})`,
  );

  const pages = pageNames(appSource);
  let weights = [];
  const routeViolations = [];
  try {
    weights = routeWeights({
      manifest,
      chunks,
      initialNames,
      pages,
      publicPages: budget.publicPages,
      extras: budget.runtimeAfterLogin,
    });
  } catch (e) {
    routeViolations.push(e instanceof Error ? e.message : String(e));
  }
  console.log('Peso por ruta (inicial + lo que trae la página):');
  for (const w of [...weights].sort((a, b) => b.totalKb - a.totalKb)) {
    console.log(`  ${w.totalKb.toFixed(1).padStart(7)} kB  ${w.route} (+${w.ownKb.toFixed(1)})`);
  }
  routeViolations.push(...checkRoutes(weights, budget, { expectedPages: pages.length }));

  const violations = [...checkBudget(chunks, budget, initialNames), ...routeViolations];
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
