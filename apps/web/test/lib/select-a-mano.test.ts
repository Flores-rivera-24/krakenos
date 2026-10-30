import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ficheros, nombreDe } from './_fuentes';

/**
 * Gate: ningún `<select>` nativo a mano fuera del componente común.
 *
 * Los selects se escriben con `Select` (`components/ui/select.tsx`), que fija la altura
 * táctil (44 px bajo `md`), el borde de campo, el foco y el color de los menús. Uno a mano
 * vuelve a repartir esos estilos por la web, y se desvían en silencio.
 *
 * Por AST: cuenta elementos JSX intrínsecos `select` (minúscula). `<Select />` y los
 * comentarios no cuentan. El único fichero que lo escribe es el propio componente.
 */

const COMPONENTE = 'components/ui/select.tsx';

/**
 * Ficheros con un `<select>` nativo permitido. Vacía a propósito: una entrada exige su
 * porqué, y falla si queda obsoleta.
 */
const EXCEPCIONES: Record<string, string> = {};

/** Líneas (1-based) de cada elemento JSX intrínseco `select`. */
export function selectsAMano(nombre: string, codigo: string): number[] {
  const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Falla cerrado: un fuente que no parsea daría una lista vacía y el gate pasaría en falso.
  const diagnosticos = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
  if (diagnosticos && diagnosticos.length > 0) {
    throw new Error(`No se pudo analizar ${nombre}: ${diagnosticos.length} error(es) de sintaxis`);
  }
  const salida: number[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) &&
      nodo.tagName.getText(sf) === 'select'
    ) {
      salida.push(sf.getLineAndCharacterOfPosition(nodo.getStart()).line + 1);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return salida;
}

describe('select-a-mano', () => {
  it('control positivo: cuenta <select> en JSX y no en comentarios ni <Select>', () => {
    expect(selectsAMano('x.tsx', '[<select />,\n// <select>\n<Select />]')).toEqual([1]);
    expect(
      selectsAMano('x.tsx', 'const a = (\n  <select value={v}>\n    <option />\n  </select>\n);'),
    ).toEqual([2]);
  });

  it('falla cerrado con un fuente roto', () => {
    expect(() => selectsAMano('x.tsx', 'const a = <select')).toThrow(/x\.tsx/);
  });

  const recorridos = ficheros().filter((ruta) => ruta.endsWith('.tsx'));
  const hallazgos = recorridos.flatMap((ruta) => {
    const nombre = nombreDe(ruta);
    return selectsAMano(nombre, readFileSync(ruta, 'utf8')).map((linea) => ({ nombre, linea }));
  });

  it('el recorrido ve el árbol de fuentes', () => {
    expect(recorridos.length).toBeGreaterThan(100);
  });

  it('el componente común sí escribe el <select>', () => {
    expect(hallazgos.some((h) => h.nombre === COMPONENTE)).toBe(true);
  });

  it('ningún <select> fuera de components/ui/select.tsx', () => {
    const fuera = hallazgos
      .filter((h) => h.nombre !== COMPONENTE && !(h.nombre in EXCEPCIONES))
      .map((h) => `${h.nombre}:${h.linea}`);
    expect(
      fuera,
      'Usa <Select> de components/ui/select.tsx en vez de un <select> a mano:\n' + fuera.join('\n'),
    ).toEqual([]);
  });

  it('la allowlist no tiene entradas obsoletas', () => {
    const conSelect = new Set(hallazgos.map((h) => h.nombre));
    const obsoletas = Object.keys(EXCEPCIONES).filter((n) => !conSelect.has(n));
    expect(obsoletas).toEqual([]);
  });
});
