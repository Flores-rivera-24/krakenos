#!/usr/bin/env node
// US-95 — Mide el contraste WCAG real de los pares fondo/texto de los tokens kr-*
// definidos en `src/index.css`, y vuelca una tabla en `docs/accessibility.md`.
// Uso: `node scripts/check-contrast.mjs` (escribe el doc) o `--check` (solo verifica
// y sale con código 1 si algún par de texto normal queda por debajo de 4.5:1).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../src/index.css');
const docPath = resolve(here, '../../../docs/accessibility.md');

const css = readFileSync(cssPath, 'utf8');

/** Extrae `--kr-*: #hex;` del primer bloque que empieza por `selector {`. */
function parseBlock(selector) {
  const start = css.indexOf(selector);
  if (start === -1) return {};
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  const tokens = {};
  for (const m of body.matchAll(/--(kr-[\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}

// El tema oscuro es el default en `:root`; el claro sobreescribe en `html:not(.dark)`.
const darkTokens = parseBlock(':root');
const lightTokens = { ...darkTokens, ...parseBlock('html:not(.dark)') };

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function relLuminance([r, g, b]) {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(fg, bg) {
  const l1 = relLuminance(hexToRgb(fg));
  const l2 = relLuminance(hexToRgb(bg));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// Pares fondo/texto a evaluar. `large:true` ⇒ umbral 3:1 (texto grande / icono / componente).
const BG = ['kr-bg-base', 'kr-bg-surface', 'kr-bg-elevated'];
const TEXT = ['kr-text-primary', 'kr-text-secondary', 'kr-text-muted', 'kr-link'];
const SEMANTIC = ['kr-success', 'kr-info', 'kr-warning', 'kr-danger'];

function buildPairs(tokens) {
  const pairs = [];
  for (const bg of BG) {
    for (const fg of TEXT) pairs.push({ fg, bg, large: false });
  }
  // Colores semánticos como texto sobre superficie (su uso típico en tarjetas).
  for (const fg of SEMANTIC) pairs.push({ fg, bg: 'kr-bg-surface', large: false });
  // El acento solo se usa como TEXTO en iconos/logo (gráfico, umbral 3:1); como texto
  // normal se usa `kr-link`. Como FONDO de botón, el texto blanco encima.
  pairs.push({ fg: 'kr-accent', bg: 'kr-bg-surface', large: true });
  pairs.push({ fg: '#ffffff', bg: 'kr-accent', large: false, fgName: 'white' });
  return pairs.map((p) => {
    const fgHex = p.fg.startsWith('#') ? p.fg : tokens[p.fg];
    const bgHex = tokens[p.bg];
    const r = ratio(fgHex, bgHex);
    const min = p.large ? 3 : 4.5;
    return { ...p, fgHex, bgHex, ratio: r, min, pass: r >= min };
  });
}

function table(theme, pairs) {
  const rows = pairs.map((p) => {
    const fg = p.fgName ?? p.fg;
    const status = p.pass ? '✅ AA' : '❌ FALLA';
    return `| \`${fg}\` ${p.fgHex} | \`${p.bg}\` ${p.bgHex} | ${p.ratio.toFixed(2)}:1 | ${p.min}:1 | ${status} |`;
  });
  return [
    `### Tema ${theme}`,
    '',
    '| Texto | Fondo | Ratio | Mínimo AA | Resultado |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

const darkPairs = buildPairs(darkTokens);
const lightPairs = buildPairs(lightTokens);
const failures = [...darkPairs, ...lightPairs].filter((p) => !p.pass);

const doc = `# Accesibilidad — KrakenOS

> Generado por \`apps/web/scripts/check-contrast.mjs\` a partir de los tokens kr-* de
> \`apps/web/src/index.css\`. Reejecuta el script tras tocar la paleta.

## Contraste WCAG 2.1 (US-95)

Umbrales AA: **4.5:1** texto normal · **3:1** texto grande / componentes. Ratios calculados
con la fórmula de luminancia relativa sRGB sobre los pares fondo/texto reales de la paleta.

${table('oscuro (por defecto)', darkPairs)}
${table('claro', lightPairs)}

## Cobertura por herramienta (axe-core)

\`test/a11y/pages.a11y.test.tsx\` monta cada página y exige **cero violaciones** de las reglas
WCAG 2.0/2.1 A y AA de axe-core (nombres accesibles de controles, roles, labels de formulario,
etc.). El contraste de color no se puede medir en jsdom (sin layout real), por eso se calcula
aparte con este script. Cubre el trabajo previo de US-62 (labels de iconos/formularios, captions
y \`scope\` en tablas, \`aria-sort\`, focus-trap en Slideover/Dialog) sin rehacerlo.

_Última verificación: ${failures.length === 0 ? 'todos los pares cumplen AA.' : `${failures.length} par(es) por debajo del mínimo (ver ❌ arriba).`}_
`;

if (!process.argv.includes('--check')) {
  writeFileSync(docPath, doc);
  console.log(`Escrito ${docPath}`);
}

console.log(`\nPares por debajo del mínimo AA: ${failures.length}`);
for (const f of failures) {
  const fg = f.fgName ?? f.fg;
  console.log(`  ❌ ${fg} (${f.fgHex}) sobre ${f.bg} (${f.bgHex}) = ${f.ratio.toFixed(2)}:1 (min ${f.min}:1)`);
}

if (process.argv.includes('--check') && failures.length > 0) process.exit(1);
