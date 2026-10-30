import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ficheros, nombreDe, sinComentariosConLineas } from './_fuentes';

/**
 * Gate de los campos editables en el celular.
 *
 * Por debajo de 16 px, iOS Safari hace zoom al enfocar un campo y deja la página ampliada; y por
 * debajo de 44 px de alto el pulgar no acierta. Todo campo editable (`<input>` de texto, `<select>`,
 * `<textarea>`, y los componentes `Input`/`Textarea`) declara, sin prefijo, `text-base` (16 px) y
 * `min-h-11` (44 px), y los deshace en escritorio (`md:text-…`, `md:min-h-0`) para que a 1280 px
 * midan lo de siempre.
 *
 * Además, el `className` que un consumidor pasa a `<Input>`/`<Textarea>` no puede traer un tamaño
 * de letra sin `md:`: `cn` (tailwind-merge) lo dejaría ganar al `text-base` de la base y el campo
 * volvería a hacer zoom, sin un solo error.
 *
 * Limitación: `tokensDe` solo ve literales y constantes de módulo en MAYÚSCULAS; una clase que llegue por
 * prop o por otra variable no se ve.
 *
 * Casillas, radios, rangos, ficheros, colores y botones no son campos de texto: quedan fuera.
 * El e2e `tactil.spec.ts` mide el efecto real (font-size calculado y altura).
 */

/** Tipos de `<input>` que no son campos de texto (no hacen zoom ni se teclean). */
const TIPOS_EXCLUIDOS = new Set([
  'checkbox',
  'radio',
  'range',
  'file',
  'color',
  'hidden',
  'button',
  'submit',
  'reset',
  'image',
]);

const TAG = /<(input|select|textarea|Input|Textarea|Select)(?=[\s/>])/g;
/** Tamaño de letra de campo SIN prefijo que no es `text-base`. */
const LETRA_CHICA = /^text-(?:xs|sm|lg|xl|\dxl|kr-(?:xs|sm|base|lg|xl|2xl)|\[[^\]]*\])$/;

interface Campo {
  etiqueta: string;
  linea: number;
  tokens: string[];
  tipo: string | null;
}

/** Texto de la etiqueta de apertura que empieza en `ini` (respeta llaves y comillas). */
function etiquetaDesde(codigo: string, ini: number): string {
  let prof = 0;
  let comilla: string | null = null;
  for (let i = ini; i < codigo.length; i++) {
    const c = codigo[i]!;
    if (comilla) {
      if (c === '\\') i++;
      else if (c === comilla) comilla = null;
    } else if (c === '"' || c === "'" || c === '`') comilla = c;
    else if (c === '{') prof++;
    else if (c === '}') prof--;
    else if (c === '>' && prof === 0 && codigo[i - 1] !== '=') return codigo.slice(ini, i + 1);
  }
  return codigo.slice(ini);
}

/** Valor de `className=…` dentro de una etiqueta, o null. */
function valorClassName(tag: string): string | null {
  const m = /[cC]lassName\s*=\s*/.exec(tag);
  if (!m) return null;
  const ini = m.index + m[0].length;
  const abre = tag[ini];
  if (abre === '"' || abre === "'") return tag.slice(ini, tag.indexOf(abre, ini + 1) + 1);
  if (abre !== '{') return null;
  let prof = 0;
  let comilla: string | null = null;
  for (let i = ini; i < tag.length; i++) {
    const c = tag[i]!;
    if (comilla) {
      if (c === '\\') i++;
      else if (c === comilla) comilla = null;
    } else if (c === '"' || c === "'" || c === '`') comilla = c;
    else if (c === '{') prof++;
    else if (c === '}' && --prof === 0) return tag.slice(ini, i + 1);
  }
  return null;
}

/** Constantes de módulo de tipo cadena (`const SELECT_CLASS = '…'`), por nombre. */
function constantes(codigo: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const re = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo))) mapa.set(m[1]!, m[3]!);
  return mapa;
}

/** Las clases de una expresión `className`: cadenas literales + constantes del módulo citadas. */
function tokensDe(valor: string, consts: Map<string, string>): string[] {
  const textos: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(valor))) textos.push(m[2]!);
  for (const [nombre, texto] of consts) {
    if (new RegExp(`(?<![\\w$])${nombre}(?![\\w$])`).test(valor)) textos.push(texto);
  }
  return textos.join(' ').split(/\s+/).filter(Boolean);
}

/** Todos los campos (nativos y componentes) del código, ya sin los excluidos por tipo. */
export function camposEditables(codigo: string): { campos: Campo[]; excluidos: number } {
  const consts = constantes(codigo);
  const campos: Campo[] = [];
  let excluidos = 0;
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(codigo))) {
    const tag = etiquetaDesde(codigo, m.index);
    const tipo = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag);
    const t = tipo ? (tipo[1] ?? tipo[2] ?? null) : null;
    if (t && TIPOS_EXCLUIDOS.has(t)) {
      excluidos++;
      continue;
    }
    const valor = valorClassName(tag);
    campos.push({
      etiqueta: m[1]!,
      linea: codigo.slice(0, m.index).split('\n').length,
      tokens: valor ? tokensDe(valor, consts) : [],
      tipo: t,
    });
  }
  return { campos, excluidos };
}

/** Qué le falta a un campo, en palabras; vacío si cumple. */
export function defectosDe(c: Campo): string[] {
  const falta: string[] = [];
  const nativo = c.etiqueta === c.etiqueta.toLowerCase();
  const chica = c.tokens.filter((x) => LETRA_CHICA.test(x));
  if (chica.length) falta.push(`letra sin md: (${chica.join(', ')})`);
  if (nativo) {
    if (!c.tokens.includes('text-base')) falta.push('sin text-base');
    else if (
      !c.tokens.some((x) =>
        /^md:text-(?:xs|sm|base|lg|xl|2xl|kr-(?:xs|sm|base|lg|xl|2xl))$/.test(x),
      )
    )
      falta.push('text-base sin md:text-<tamaño> (crecería a 16 px en escritorio)');
    if (c.etiqueta !== 'textarea') {
      if (!c.tokens.includes('min-h-11')) falta.push('sin min-h-11');
      if (!c.tokens.includes('md:min-h-0')) falta.push('sin md:min-h-0');
    }
  }
  return falta;
}

interface Hallazgo {
  donde: string;
  falta: string[];
}

function hallazgosDe(nombre: string, fuente: string): Hallazgo[] {
  const { campos } = camposEditables(sinComentariosConLineas(fuente));
  return campos
    .map((c) => ({ donde: `${nombre}:${c.linea} <${c.etiqueta}>`, falta: defectosDe(c) }))
    .filter((h) => h.falta.length > 0);
}

describe('campos editables en el celular', () => {
  const todas = ficheros().map((ruta) => ({
    nombre: nombreDe(ruta),
    fuente: readFileSync(ruta, 'utf8'),
  }));

  it('la recolección ve los campos (guard de tamaño mínimo)', () => {
    let nativos = 0;
    let componentes = 0;
    let excluidos = 0;
    for (const f of todas) {
      const r = camposEditables(sinComentariosConLineas(f.fuente));
      excluidos += r.excluidos;
      for (const c of r.campos) {
        if (c.etiqueta === c.etiqueta.toLowerCase()) nativos++;
        else componentes++;
      }
    }
    // Medido el 2026-10-29 (con `Select` contado como componente): 8 nativos editables, 166 componentes, 19 excluidos por tipo.
    expect(nativos).toBeGreaterThan(4);
    expect(componentes).toBeGreaterThan(120);
    expect(excluidos).toBeGreaterThan(10);
  });

  it('todo campo editable lleva text-base y min-h-11 con su deshacer en md:, y ninguna letra chica sin md:', () => {
    const hallazgos = todas.flatMap((f) => hallazgosDe(f.nombre, f.fuente));
    expect(hallazgos.map((h) => `${h.donde}: ${h.falta.join('; ')}`)).toEqual([]);
  });

  it('control positivo: el detector marca lo que debe, tolera el formateador y deja pasar lo excluido', () => {
    const malo = [
      '<select\n  value={x}\n  className="h-9 rounded-md px-2 text-kr-sm"\n>',
      '<input\n  type="text"\n  className={cn(\n    "text-base",\n    "text-sm",\n  )}\n/>',
      '<Input id="a" className="text-sm md:text-sm" />',
      '<textarea className="rounded-md" />',
      '<select className="text-base min-h-11 md:min-h-0" />',
      // `md:text-<color>` no devuelve el tamaño: en escritorio el campo seguiría en 16 px.
      '<select className="text-base min-h-11 md:min-h-0 md:text-kr-primary" />',
    ];
    for (const m of malo) expect(hallazgosDe('muestra.tsx', m)).toHaveLength(1);

    const bueno = [
      '<input type="number" className="min-h-11 md:min-h-0 text-base md:text-sm" />',
      '<Input className="w-20 pr-10" />',
      '<input type="checkbox" className="text-sm" />',
      '<input type="range" />',
      "const S = 'min-h-11 md:min-h-0 text-base md:text-kr-sm';\n<select className={cn(S, 'w-auto')}>",
    ];
    for (const b of bueno) expect(hallazgosDe('muestra.tsx', b)).toEqual([]);
  });
});
