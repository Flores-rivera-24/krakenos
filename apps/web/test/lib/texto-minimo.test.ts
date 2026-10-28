import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ficheros, nombreDe, sinComentariosConLineas } from './_fuentes';

/**
 * Gate del texto mínimo y de los comandos copiables.
 *
 * (a) Nada se lee por debajo de 11 px: la escala del proyecto empieza en `text-kr-xs` (11 px). Un
 * `text-[10px]` a pelo se salta la escala y en un celular queda ilegible. Se mira cualquier
 * `text-[Npx]`, `text-[Nrem]` o `text-[Nem]` (también con prefijo: `md:text-[9px]`,
 * `max-md:text-[0.5rem]`) en TODO `src/`, no solo en `className=`, tolerando el formateador, y en
 * código, no en comentarios. Un `em` se toma contra 16 px, como el `rem`.
 *
 * (b) Un `<code>` que lleva un comando o un enlace para copiar no puede llevar `truncate`: el
 * usuario copia con el botón, pero no ve qué está copiando (una URL o un comando cortado con «…»).
 * Se ven enteros: `break-all` + `overflow-x-auto`. Se lee por AST (cualquier prefijo: `md:truncate`
 * también cuenta, porque a ese ancho vuelve a cortar).
 *
 * Alcance honesto: (a) no ve un tamaño que llegue por variable ni una clase armada por
 * concatenación; (b) solo ve `className` literal o plantilla en un `<code>` JSX, no un `<code>`
 * dentro de otro componente que reciba la clase por prop.
 */

const MINIMO_PX = 11;
const PX_POR_REM = 16;

interface Hallazgo {
  fichero: string;
  linea: number;
  texto: string;
}

const TAMANO = /text-\[(?:length:)?(\d*\.?\d+)(px|rem|em)\]/g;

function tamanosChicos(nombre: string, codigo: string): Hallazgo[] {
  const salida: Hallazgo[] = [];
  for (const m of codigo.matchAll(TAMANO)) {
    const valor = Number(m[1]);
    const px = m[2] === 'px' ? valor : valor * PX_POR_REM;
    if (px < MINIMO_PX) {
      salida.push({
        fichero: nombre,
        linea: codigo.slice(0, m.index).split('\n').length,
        texto: m[0],
      });
    }
  }
  return salida;
}

const TRUNCATE = /(?:^|[\s"'`:])truncate(?=$|[\s"'`])/;

function codeTruncados(nombre: string, fuente: string): Hallazgo[] {
  const sf = ts.createSourceFile(nombre, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const salida: Hallazgo[] = [];
  const visita = (nodo: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) &&
      nodo.tagName.getText(sf) === 'code'
    ) {
      for (const attr of nodo.attributes.properties) {
        if (ts.isJsxAttribute(attr) && attr.name.getText(sf) === 'className' && attr.initializer) {
          const valor = attr.initializer.getText(sf);
          if (TRUNCATE.test(valor)) {
            salida.push({
              fichero: nombre,
              linea: sf.getLineAndCharacterOfPosition(nodo.getStart(sf)).line + 1,
              texto: '<code … truncate>',
            });
          }
        }
      }
    }
    ts.forEachChild(nodo, visita);
  };
  visita(sf);
  return salida;
}

const citar = (h: Hallazgo[]) => h.map((x) => `${x.fichero}:${x.linea} ${x.texto}`);

const rutas = ficheros();

describe('texto mínimo y comandos copiables', () => {
  it('guard: recoge los ficheros de src', () => {
    // Medido 2026-10-27: 262 ficheros .ts/.tsx.
    expect(rutas.length).toBeGreaterThan(200);
  });

  it('(a) nada se lee por debajo de 11 px', () => {
    const hallazgos = rutas.flatMap((r) =>
      tamanosChicos(nombreDe(r), sinComentariosConLineas(readFileSync(r, 'utf8'))),
    );
    expect(citar(hallazgos)).toEqual([]);
  });

  it('(a) control positivo: ve px, rem, em, prefijos y el límite', () => {
    const muestra = [
      'a="text-[10px]"',
      'b="md:text-[9px]"',
      'c="max-md:text-[0.5rem]"',
      'd="text-[0.625em]"',
      'e="text-[11px] text-[13px] text-[0.6875rem] text-[0.75rem]"',
    ].join('\n');
    expect(tamanosChicos('x.tsx', muestra).map((h) => `${h.linea}:${h.texto}`)).toEqual([
      '1:text-[10px]',
      '2:text-[9px]',
      '3:text-[0.5rem]',
      '4:text-[0.625em]',
    ]);
  });

  it('(b) ningún <code> lleva truncate', () => {
    const hallazgos = rutas.flatMap((r) => codeTruncados(nombreDe(r), readFileSync(r, 'utf8')));
    expect(citar(hallazgos)).toEqual([]);
  });

  it('(b) control positivo: ve literal, plantilla y prefijo; ignora lo demás', () => {
    const muestra = `
      const a = <code className="min-w-0 truncate font-mono">x</code>;
      const b = <code className={\`flex md:truncate \${z}\`}>x</code>;
      const c = <code className="break-all overflow-x-auto">x</code>;
      const d = <p className="truncate">x</p>;
      const e = <code className={cn('a', 'truncate')}>x</code>;
    `;
    expect(codeTruncados('x.tsx', muestra).map((h) => h.linea)).toEqual([2, 3, 6]);
  });
});
