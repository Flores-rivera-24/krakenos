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

/**
 * Extrae `--kr-*: #hex;` del bloque de un selector. El selector se busca **al
 * principio de línea** a propósito: `indexOf('.dark')` casaba antes con la mención
 * `:root:not(.dark)` que hay dentro de un comentario, no con el bloque real.
 */
function parseBlock(selectorRegex) {
  const m = new RegExp(`^\\s*${selectorRegex}\\s*\\{`, 'm').exec(css);
  if (!m) return {};
  const body = css.slice(m.index + m[0].length, css.indexOf('}', m.index + m[0].length));
  const tokens = {};
  for (const t of body.matchAll(/--(kr-[\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    tokens[t[1]] = t[2];
  }
  return tokens;
}

/**
 * US-231 (AUD3-30) — **este medidor daba falso verde.**
 *
 * Medía solo `:root` mientras la app renderiza con `<html class="dark">`, y `.dark`
 * **sobreescribe** algún token: `kr-text-muted` vale `#868f9a` en `:root` pero
 * `#7d8590` en `.dark`. CI publicaba ✅ sobre un valor que el usuario nunca ve.
 * Ahora se compone cada tema como lo compone el navegador:
 *   · oscuro (default) = `:root` + `.dark` encima
 *   · claro            = `:root` + `html:not(.dark)` encima
 */
const rootTokens = parseBlock(':root');
const darkOverrides = parseBlock('\\.dark');
const lightOverrides = parseBlock('html:not\\(\\.dark\\)');

/**
 * Falla CERRADO si no encuentra un bloque de tokens. Sin esto, un bloque movido o renombrado
 * (p. ej. al reorganizar `index.css`) dejaba `{}` y el tema afectado se medía con los valores de
 * `:root` solos: el medidor seguía en verde sobre una paleta que ya no estaba midiendo.
 */
for (const [nombre, tokens] of [
  [':root', rootTokens],
  ['.dark', darkOverrides],
  ['html:not(.dark)', lightOverrides],
]) {
  if (Object.keys(tokens).length === 0) {
    console.error(
      `check-contrast: no se encontró ningún token --kr-*: #hex en el bloque \`${nombre}\` de ${cssPath}. ` +
        'Si se movió o renombró el bloque, hay que ajustar este script: no se mide una paleta que no se ve.',
    );
    process.exit(1);
  }
}

const darkTokens = { ...rootTokens, ...darkOverrides };
const lightTokens = { ...rootTokens, ...lightOverrides };

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
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

/** Mezcla `fg` al `pct` con `bg` por canal en sRGB: lo que hace `color-mix(in srgb, …)`. */
function mixHex(fgHex, bgHex, pct) {
  const f = hexToRgb(fgHex);
  const b = hexToRgb(bgHex);
  const c = f.map((v, i) => Math.round(pct * v + (1 - pct) * (b[i] ?? 0)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const faltantes = new Set();
/**
 * Falla CERRADO: un token que el script pide y el tema no define no se mide en silencio con
 * `undefined` (daría NaN, que no es `< min` y pasaría). Se acumulan todos para nombrarlos juntos.
 */
function tokenOrDie(tokens, name, theme) {
  const v = tokens[name];
  if (!v) faltantes.add(`--${name} (tema ${theme})`);
  return v ?? '#000000';
}

// `kind`: texto (4,5:1 normal / 3:1 grande), componente (3:1, WCAG 1.4.11), sólido (texto sobre
// un relleno), tinta (texto sobre su propio color al 10 % mezclado con la superficie).
function buildPairs(tokens, theme) {
  const pairs = [];
  for (const bg of BG) {
    for (const fg of TEXT) pairs.push({ fg, bg, large: false, kind: 'texto' });
  }
  // Colores semánticos como texto sobre superficie (su uso típico en tarjetas).
  for (const fg of SEMANTIC) pairs.push({ fg, bg: 'kr-bg-surface', large: false, kind: 'texto' });
  // El acento solo se usa como TEXTO en iconos/logo (gráfico, umbral 3:1); como texto
  // normal se usa `kr-link`. Como FONDO de botón, el texto blanco encima.
  pairs.push({ fg: 'kr-accent', bg: 'kr-bg-surface', large: true, kind: 'texto' });
  pairs.push({ fg: '#ffffff', bg: 'kr-accent', large: false, fgName: 'white', kind: 'sólido' });
  // El botón destructivo: texto blanco sobre su relleno.
  pairs.push({
    fg: '#ffffff',
    bg: 'kr-danger-solid',
    large: false,
    fgName: 'white',
    kind: 'sólido',
  });
  // US-231: faltaba `kr-offline`, el color del `StatusDot` de «desconectado» —el
  // indicador más repetido de toda la app—. Es gráfico, no texto: umbral 3:1.
  for (const bg of BG) pairs.push({ fg: 'kr-offline', bg, large: true, kind: 'componente' });
  // Controles (WCAG 1.4.11, 3:1): el borde del campo y el carril del interruptor apagado se
  // pintan sobre surface (tarjetas) o elevated (diálogos, paneles); el anillo de foco, sobre las tres.
  for (const fg of ['kr-border-field', 'kr-switch-off']) {
    for (const bg of ['kr-bg-surface', 'kr-bg-elevated']) {
      pairs.push({ fg, bg, large: true, kind: 'componente' });
    }
  }
  for (const bg of BG) pairs.push({ fg: 'kr-ring', bg, large: true, kind: 'componente' });
  // Texto semántico sobre su propia tinta (`bg-success/10`…): el medidor medía el token
  // sobre la superficie lisa y no sobre lo que hay debajo del aviso.
  for (const base of ['kr-bg-surface', 'kr-bg-elevated']) {
    for (const fg of SEMANTIC) {
      pairs.push({
        fg,
        bg: `${fg} 10 % sobre ${base}`,
        tint: fg,
        tintBase: base,
        large: false,
        kind: 'tinta',
      });
    }
  }
  return pairs.map((p) => {
    const fgHex = p.fg.startsWith('#') ? p.fg : tokenOrDie(tokens, p.fg, theme);
    const bgHex = p.tint
      ? mixHex(tokenOrDie(tokens, p.tint, theme), tokenOrDie(tokens, p.tintBase, theme), 0.1)
      : tokenOrDie(tokens, p.bg, theme);
    const r = ratio(fgHex, bgHex);
    const min = p.large ? 3 : 4.5;
    return { ...p, fgHex, bgHex, ratio: r, min, pass: r >= min };
  });
}

function table(theme, pairs) {
  const rows = pairs.map((p) => {
    const fg = p.fgName ?? p.fg;
    const status = p.pass ? '✅ AA' : '❌ FALLA';
    return `| ${p.kind} | \`${fg}\` ${p.fgHex} | \`${p.bg}\` ${p.bgHex} | ${p.ratio.toFixed(2)}:1 | ${p.min}:1 | ${status} |`;
  });
  return [
    `### Tema ${theme}`,
    '',
    '| Tipo | Texto | Fondo | Ratio | Mínimo AA | Resultado |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

const darkPairs = buildPairs(darkTokens, 'oscuro');
const lightPairs = buildPairs(lightTokens, 'claro');
if (faltantes.size > 0) {
  console.error(
    `check-contrast: faltan tokens en ${cssPath}:\n  ${[...faltantes].join('\n  ')}\n` +
      'Defínelos en :root, .dark y html:not(.dark) (en hex), o quita el par de buildPairs.',
  );
  process.exit(1);
}

const failures = [...darkPairs, ...lightPairs].filter((p) => !p.pass);

const doc = `# Accesibilidad — KrakenOS

> Generado por \`apps/web/scripts/check-contrast.mjs\` a partir de los tokens kr-* de
> \`apps/web/src/index.css\`. Reejecuta el script tras tocar la paleta.

## Contraste WCAG 2.1

Umbrales AA: **4.5:1** texto normal · **3:1** texto grande / componentes (bordes de campo, interruptor apagado, anillo de foco). Ratios calculados
con la fórmula de luminancia relativa sRGB sobre los pares fondo/texto reales de la paleta.

${table('oscuro (por defecto)', darkPairs)}
${table('claro', lightPairs)}

## Cobertura por herramienta (axe-core)

\`test/a11y/pages.a11y.test.tsx\` monta cada página y exige **cero violaciones** de las reglas
WCAG 2.0/2.1 A y AA de axe-core (nombres accesibles de controles, roles, labels de formulario,
etc.). El contraste de color no se puede medir en jsdom (sin layout real), por eso se calcula
aparte con este script. Cubre el trabajo previo (labels de iconos/formularios, captions
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
  console.log(
    `  ❌ ${fg} (${f.fgHex}) sobre ${f.bg} (${f.bgHex}) = ${f.ratio.toFixed(2)}:1 (min ${f.min}:1)`,
  );
}

if (process.argv.includes('--check') && failures.length > 0) process.exit(1);
