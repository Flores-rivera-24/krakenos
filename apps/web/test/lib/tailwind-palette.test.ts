import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * US-231 (AUD3-30) — **el gate de contraste era esquivable.**
 *
 * `check-contrast.mjs` mide los tokens `--kr-*`, así que un color de la paleta
 * cruda de Tailwind escrito a pelo en un componente **no pasa por ningún gate**.
 * Había 18 en 10 ficheros; el peor, `text-yellow-500`, daba **1,92:1** en tema
 * claro (el mínimo AA para texto es 4,5:1) y CI publicaba ✅.
 *
 * Este test cierra la puerta: todo color visible sale de un token semántico
 * (`text-success`, `text-warning`, `text-danger`, `bg-kr-*`…), que sí se mide.
 * Ver también la regla del sistema de diseño en `docs/design-system.md`:
 * «Nunca hardcodear colores: usar `kr-*`».
 */

// `import.meta.url` no es una URL de fichero bajo jsdom; vitest corre con el cwd
// del paquete (`apps/web`), así que la raíz se resuelve desde ahí.
const SRC = join(process.cwd(), 'src');

/** Lista recursiva de fuentes (sin `fs.globSync`, que es de Node 22+). */
function listarFuentes(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...listarFuentes(ruta));
    else if (/\.tsx?$/.test(entrada.name)) salida.push(relative(SRC, ruta));
  }
  return salida;
}

/** Familias de color de la paleta por defecto de Tailwind. */
const FAMILIAS = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
  'slate', 'gray', 'zinc', 'neutral', 'stone',
];

/** Utilidades de Tailwind que pintan color. */
const UTILIDADES = [
  'text', 'bg', 'border', 'ring', 'fill', 'stroke', 'from', 'to', 'via',
  'decoration', 'outline', 'divide', 'accent', 'caret', 'shadow',
];

const CRUDO = new RegExp(
  String.raw`\b(?:${UTILIDADES.join('|')})-(?:${FAMILIAS.join('|')})-\d{2,3}\b`,
  'g',
);

/**
 * Excepciones justificadas. Vacío a propósito: hoy no hace falta ninguna. Si
 * alguna vez se añade una, debe llevar el motivo escrito — «me corría prisa» no
 * es un motivo, y la alternativa (añadir un token `kr-*`) casi siempre es mejor.
 */
const EXCEPCIONES: { fichero: string; clase: string; motivo: string }[] = [];

describe('la paleta cruda de Tailwind no puede esquivar el gate de contraste (US-231)', () => {
  const ficheros = listarFuentes(SRC).sort();

  it('el barrido encontró ficheros que revisar (guard de recolección)', () => {
    // Sin esto, un glob roto haría pasar el test sin haber mirado nada.
    expect(ficheros.length).toBeGreaterThan(100);
  });

  it('ningún componente usa un color de la paleta por defecto', () => {
    const hallazgos: string[] = [];
    for (const rel of ficheros) {
      const contenido = readFileSync(join(SRC, rel), 'utf8');
      for (const clase of contenido.match(CRUDO) ?? []) {
        const permitida = EXCEPCIONES.some((e) => e.fichero === rel && e.clase === clase);
        if (!permitida) hallazgos.push(`${rel}: ${clase}`);
      }
    }
    expect({ hallazgos }).toEqual({ hallazgos: [] });
  });
});
