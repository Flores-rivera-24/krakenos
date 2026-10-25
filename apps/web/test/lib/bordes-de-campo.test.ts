import { describe, expect, it } from 'vitest';
import { SRC, fuentes } from './_fuentes';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinComentariosConLineas } from './_fuentes';

/**
 * **Un campo de formulario lleva `border-kr-field`, no `border-kr`.**
 *
 * `border-kr` es un 8 %/10 % de opacidad (1,2:1 contra la superficie): vale para tarjetas y
 * tablas, pero un campo cuyo límite no se ve incumple WCAG 1.4.11 (3:1). `check-contrast.mjs`
 * mide el TOKEN `--kr-border-field`; este gate ata que los campos lo USEN. Se deriva del código:
 * recorre todo `src/` y mira cada `<input`, `<select`, `<textarea` y las constantes de clase de
 * campo (`SELECT_CLASS`, `INPUT_CLASS`…), sin lista de ficheros escrita a mano.
 */

const BORDE_VIEJO = /\bborder-(?:kr(?![-\w])|input\b)/;

/** Allowlist razonada: `fichero:línea-de-código` → motivo. Falla si queda obsoleta. */
const PERMITIDOS: Record<string, string> = {};

interface Hallazgo {
  donde: string;
  texto: string;
}

/** Las etiquetas `<input|select|textarea …>` (hasta el `>` fuera de llaves) y las constantes de clase de campo. */
export function hallazgos(nombre: string, codigo: string): { vistos: number; malos: Hallazgo[] } {
  const malos: Hallazgo[] = [];
  let vistos = 0;
  const linea = (i: number) => codigo.slice(0, i).split('\n').length;

  for (const m of codigo.matchAll(/<(input|select|textarea)\b/g)) {
    vistos++;
    let prof = 0;
    let fin = m.index + m[0].length;
    for (; fin < codigo.length; fin++) {
      const c = codigo[fin];
      if (c === '{') prof++;
      else if (c === '}') prof--;
      else if (c === '>' && prof === 0 && codigo[fin - 1] !== '=') break;
    }
    const etiqueta = codigo.slice(m.index, fin);
    const rel = etiqueta.match(BORDE_VIEJO);
    if (rel)
      malos.push({
        donde: `${nombre}:${linea(m.index + (rel.index ?? 0))}`,
        texto: etiqueta.replace(/\s+/g, ' ').slice(0, 60),
      });
  }

  for (const m of codigo.matchAll(
    /\bconst\s+([A-Za-z_]*(?:CLASS|CLS|FIELD|INPUT|SELECT|TEXTAREA)[A-Za-z_]*)\s*(?::[^=]+)?=\s*(['"`])([\s\S]*?)\2/gi,
  )) {
    vistos++;
    const rel = m[3]?.match(BORDE_VIEJO);
    if (rel)
      malos.push({
        donde: `${nombre}:${linea(m.index + m[0].indexOf(m[3] ?? '') + (rel.index ?? 0))}`,
        texto: m[1] ?? '',
      });
  }
  return { vistos, malos };
}

describe('campos de formulario con border-kr-field', () => {
  const todos = fuentes().map((f) => {
    const crudo = readFileSync(join(SRC, f.nombre), 'utf8');
    return { nombre: f.nombre, codigo: sinComentariosConLineas(crudo) };
  });

  it('guard de tamaño: el recorrido ve decenas de campos', () => {
    const vistos = todos.reduce((n, f) => n + hallazgos(f.nombre, f.codigo).vistos, 0);
    expect(vistos).toBeGreaterThan(60); // medido: 84 etiquetas + constantes al escribirlo
  });

  it('control positivo: el detector caza un campo con border-kr y una constante de clase', () => {
    const malo = [
      'const SELECT_CLASS =',
      "  'h-10 border border-kr bg-kr-elevated';",
      'export const A = () => <input className="border border-kr px-2" onChange={() => 1} />;',
      'export const B = () => <input className="border border-kr-field" />;',
      'export const D = () => <select className="border border-input" />;',
      'export const C = () => <div className="border border-kr" />;',
    ].join('\n');
    const { malos } = hallazgos('sintetico.tsx', malo);
    expect(malos.map((h) => h.donde).sort()).toEqual([
      'sintetico.tsx:2',
      'sintetico.tsx:3',
      'sintetico.tsx:5',
    ]);
  });

  it('ningún campo usa border-kr o border-input (fichero:línea)', () => {
    const malos = todos
      .flatMap((f) => hallazgos(f.nombre, f.codigo).malos)
      .filter((h) => !(h.donde in PERMITIDOS));
    expect(malos.map((h) => `${h.donde}  ${h.texto}`)).toEqual([]);
  });

  it('la allowlist no tiene entradas obsoletas', () => {
    const vivos = new Set(
      todos.flatMap((f) => hallazgos(f.nombre, f.codigo).malos.map((h) => h.donde)),
    );
    expect(Object.keys(PERMITIDOS).filter((k) => !vivos.has(k))).toEqual([]);
  });
});
