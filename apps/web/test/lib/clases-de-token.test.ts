import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fuentes, sinComentarios } from './_fuentes';

/**
 * **Una clase `*-kr-*` que no existe no falla: no pinta nada.**
 *
 * Tailwind no genera CSS para una utilidad que el tema no define, y tampoco avisa:
 * el elemento hereda el fondo o el color del contenedor, que casi siempre «se ve
 * razonable». `bg-kr-bg`, `text-kr-fg` y `text-kr-fg-muted` estuvieron así en 8
 * ficheros desde que se escribieron (Cobertura, Rutinas y la tarjeta del tiempo
 * exterior) y no los cazó ningún gate: el de paleta busca la paleta cruda de
 * Tailwind y el de contraste mide los **tokens**, no las clases que los usan.
 *
 * Aquí se compara cada clase de color/tamaño/sombra/animación sobre un nombre
 * `kr-*` con lo que **define el propio `index.css`**, sin lista a mano: si alguien
 * añade o retira un token, el gate lo sigue solo.
 */

/** Utilidades de Tailwind que reciben un nombre de color (y `text`/`shadow`/`animate`, que además reciben tamaño, sombra o animación). */
const UTILIDADES = [
  'bg',
  'text',
  'border',
  'ring',
  'outline',
  'fill',
  'stroke',
  'accent',
  'caret',
  'decoration',
  'divide',
  'from',
  'via',
  'to',
  'shadow',
  'placeholder',
  'animate',
] as const;

const ES_UTILIDAD = new Set<string>(UTILIDADES);

/**
 * Lo que `index.css` declara, ya expandido a **clases** completas.
 *
 * - `--color-kr[-x]` en `@theme` → `bg-`, `text-`, `border-`… (en Tailwind 4 un color
 *   del tema genera las utilidades de todas las propiedades de color).
 * - `--text-kr-x`, `--shadow-kr-x`, `--animate-kr-x` → solo su propia utilidad.
 * - `@utility nombre` → esa clase a mano (`bg-kr-base`, `text-kr-muted`…).
 */
function clasesDefinidas(css: string): Set<string> {
  const codigo = sinComentarios(css);
  const definidas = new Set<string>();

  for (const m of codigo.matchAll(/--color-(kr(?:-[a-z0-9]+)*)\s*:/g)) {
    for (const u of UTILIDADES) {
      if (u === 'animate') continue;
      definidas.add(`${u}-${m[1]}`);
    }
  }
  for (const m of codigo.matchAll(/--(text|shadow|animate)-(kr(?:-[a-z0-9]+)*)\s*:/g)) {
    // `--text-kr-xs--line-height` es una propiedad auxiliar del tamaño, no una clase.
    if (m[2]?.includes('--')) continue;
    definidas.add(`${m[1]}-${m[2]}`);
  }
  for (const m of codigo.matchAll(/@utility\s+([a-z0-9-]+)\s*\{/g)) {
    if (m[1]?.startsWith('kr') || /-kr(-|$)/.test(m[1] ?? '')) definidas.add(m[1] ?? '');
  }
  return definidas;
}

/**
 * Las clases `<utilidad>-kr[-nombre]` de un fuente, sin variante ni modificador de
 * opacidad (`hover:bg-kr-surface/50` → `bg-kr-surface`). Se escanea el texto entero
 * y no línea a línea: Prettier parte las cadenas largas y un `cn(\n 'a',\n 'b')` no
 * puede esconder una clase.
 */
function clasesKr(codigo: string): string[] {
  const encontradas: string[] = [];
  const re = /(?<![\w-])!?([a-z]+)-(kr(?:-[a-z0-9]+)*)(?![\w-])/g;
  for (const m of codigo.matchAll(re)) {
    const utilidad = m[1] ?? '';
    if (!ES_UTILIDAD.has(utilidad)) continue;
    encontradas.push(`${utilidad}-${m[2]}`);
  }
  return encontradas;
}

const CSS = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');
const DEFINIDAS = clasesDefinidas(CSS);

describe('clases de token kr-*', () => {
  it('cada clase kr-* del fuente existe en index.css', () => {
    const usos: { clase: string; fichero: string }[] = [];
    for (const f of fuentes()) {
      for (const clase of clasesKr(f.codigo)) usos.push({ clase, fichero: f.nombre });
    }

    // Guard de tamaño: si la recolección se rompe la lista sale vacía y el test
    // pasaría. Medido el 2026-10-13: ~1.400 usos y ~70 clases definidas.
    expect(usos.length).toBeGreaterThan(50);
    expect(DEFINIDAS.size).toBeGreaterThan(10);

    const huerfanas = usos
      .filter((u) => !DEFINIDAS.has(u.clase))
      .map((u) => `${u.fichero}: ${u.clase}`);
    expect([...new Set(huerfanas)].sort()).toEqual([]);
  });

  it('control positivo: una clase inventada se marca, con variante, opacidad y en varias líneas', () => {
    const muestra = [
      'const a = "rounded border border-kr bg-kr-inventada p-3";',
      'const b = cn(',
      '  "flex items-center",',
      '  activo && "hover:text-kr-fantasma/50",',
      ');',
      'const c = `ring-kr-primary dark:!outline-kr-nada`;',
    ].join('\n');
    const huerfanas = clasesKr(muestra).filter((c) => !DEFINIDAS.has(c));
    expect(huerfanas.sort()).toEqual(['bg-kr-inventada', 'outline-kr-nada', 'text-kr-fantasma']);
  });

  it('control de la derivación: lo que sí existe no se marca', () => {
    // Un color, una utilidad a mano, un tamaño, una sombra y una animación.
    for (const clase of [
      'bg-kr-surface',
      'border-kr',
      'bg-kr-base',
      'text-kr-muted',
      'text-kr-sm',
      'shadow-kr-glow',
      'animate-kr-fade-up',
    ]) {
      expect(DEFINIDAS.has(clase), clase).toBe(true);
    }
    // Y lo que nunca existió, tampoco.
    for (const clase of ['bg-kr-bg', 'text-kr-fg', 'text-kr-fg-muted']) {
      expect(DEFINIDAS.has(clase), clase).toBe(false);
    }
  });
});
