import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SRC, ficheros } from './_fuentes';

/**
 * Gate: ninguna constante de MÓDULO guarda copy ya escrito (issue de las
 * etiquetas congeladas).
 *
 * ## Qué cazó y por qué no lo veían los otros gates
 *
 * Un `Record<DeviceType, string>` con `'Ordenador'`, una lista `{ label: 'Salón' }` o un
 * mapa de títulos de ruta se evalúa **una vez, al importar el módulo**: el texto queda
 * congelado con el idioma que hubiera entonces y no cambia al cambiar de idioma. Además
 * ni `copy-sin-traducir` (solo mira JSX, atributos y toasts) ni `texto-jsx-literal` ni
 * `atributos-literales` miran una constante. Así sobrevivieron `TYPE_LABELS`,
 * `ROLE_LABELS`, `CATEGORY_LABELS`, los títulos de `WIDGETS` y `TITULOS` de rutas.
 * La salida es guardar la CLAVE (`Record<X, TranslationKey>`) y resolverla con `t()` al
 * pintar.
 *
 * ## Qué mira
 *
 * Sentencias `const` del nivel superior del módulo (el AST de TypeScript) y cualquier
 * cadena que cuelgue de ellas cuando:
 *  - la constante está anotada `Record<…, string>` (un mapa de etiquetas), o
 *  - la cadena es el valor de una propiedad llamada `label`, `title`, `name`,
 *    `description`, `text`, `message`, `hint`, `placeholder`, `summary`, `tooltip`,
 *    `caption` o `heading`.
 * Y la cadena parece PROSA: empieza en mayúscula, lleva acento o signo español, o son
 * dos palabras en minúscula que no son clases CSS (`border-kr text-kr-secondary`).
 *
 * ## Alcance honesto
 *
 * NO ve una etiqueta de una sola palabra en minúscula y sin acento, ni una cadena en un
 * array suelto fuera de una propiedad de las de arriba, ni una constante que no esté en
 * el nivel superior (esas viven dentro de un componente y se resuelven en cada render).
 * Un genérico distinto de `Record<…, string>` (p. ej. `Partial<Record<…>>`) tampoco.
 * Lo que de verdad no es copy (marcas, identificadores internos) va en `MARCAS` y
 * `INTERNOS`, con su porqué.
 */

/** Marcas de fabricante: no se traducen (término retenido de `docs/copy-style.md`). */
const MARCAS: Record<string, string> = {
  Hue: 'marca (Philips Hue)',
  'Philips Hue': 'marca',
  Govee: 'marca',
  Tuya: 'marca',
  Zigbee: 'estándar / marca',
  Matter: 'estándar / marca',
};

/**
 * Ficheros enteros cuya constante lleva identificadores internos con forma de palabra.
 * `nav.ts`: `label` es el id con el que se filtran los grupos de la barra lateral
 * (`g.label !== 'Red avanzada'`); la cabecera visible sale de `labelKey`.
 */
const INTERNOS: Record<string, string> = {
  'components/layout/nav.ts':
    'el `label` de cada grupo es un id de filtro; lo visible es `labelKey`',
};

const PROPIEDADES_DE_COPY = new Set([
  'label',
  'title',
  'name',
  'description',
  'text',
  'message',
  'hint',
  'placeholder',
  'summary',
  'tooltip',
  'caption',
  'heading',
]);

export interface Hallazgo {
  valor: string;
  linea: number;
  via: 'Record<…, string>' | 'propiedad de copy';
}

/** ¿Parece prosa (y no un identificador, una URL o una lista de clases CSS)? */
export function pareceProsa(texto: string): boolean {
  if (!/\p{L}/u.test(texto)) return false;
  if (/^[a-z]+:\/\//i.test(texto)) return false;
  const fichas = texto.split(/\s+/);
  // `border-kr text-kr-secondary`, `bg-online`: clases CSS, no frases.
  if (fichas.every((f) => /[-:/[\]]/.test(f))) return false;
  return (
    /^[A-ZÁÉÍÓÚÑ¿¡]/.test(texto) || /[áéíóúñ¿¡…]/.test(texto) || /\p{Ll}+ \p{Ll}{3,}/u.test(texto)
  );
}

/** Copy escrito en constantes de nivel superior de un fichero. */
export function copyEnConstantes(nombre: string, fuente: string): Hallazgo[] {
  const sf = ts.createSourceFile(
    nombre,
    fuente,
    ts.ScriptTarget.Latest,
    true,
    nombre.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const salida: Hallazgo[] = [];
  for (const sentencia of sf.statements) {
    if (!ts.isVariableStatement(sentencia)) continue;
    for (const decl of sentencia.declarationList.declarations) {
      if (!decl.initializer) continue;
      const esMapaDeCadenas = /^Record<[^,]+,\s*string>$/.test(decl.type?.getText() ?? '');
      const visitar = (nodo: ts.Node, enCopy: boolean): void => {
        if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) {
          if ((esMapaDeCadenas || enCopy) && pareceProsa(nodo.text)) {
            salida.push({
              valor: nodo.text,
              linea: sf.getLineAndCharacterOfPosition(nodo.getStart()).line + 1,
              via: esMapaDeCadenas ? 'Record<…, string>' : 'propiedad de copy',
            });
          }
          return;
        }
        if (ts.isPropertyAssignment(nodo)) {
          const propiedad = nodo.name.getText().replace(/['"]/g, '');
          visitar(nodo.initializer, enCopy || PROPIEDADES_DE_COPY.has(propiedad));
          return;
        }
        // Dentro de una llamada (`cva(...)`, `t(...)`) las propiedades no son etiquetas.
        ts.forEachChild(nodo, (hijo) => visitar(hijo, enCopy && !ts.isCallExpression(nodo)));
      };
      visitar(decl.initializer, false);
    }
  }
  return salida;
}

function escanear(): { nombre: string; h: Hallazgo }[] {
  const salida: { nombre: string; h: Hallazgo }[] = [];
  for (const ruta of ficheros()) {
    const nombre = ruta.slice(SRC.length + 1);
    if (nombre.includes('lib/i18n/catalog/') || nombre.includes('lib/guides/')) continue;
    for (const h of copyEnConstantes(nombre, readFileSync(ruta, 'utf8'))) {
      salida.push({ nombre, h });
    }
  }
  return salida;
}

function esLegitimo(nombre: string, valor: string): boolean {
  return valor in MARCAS || nombre in INTERNOS;
}

/**
 * Control positivo SINTÉTICO: las formas que se escaparon (mapa de etiquetas, lista con
 * `label`, `title` de un registro) y las que NO deben contar (mapa de claves, clases CSS,
 * constante dentro de una función, llamada con opciones, URL).
 */
const MUESTRA = [
  "export const TIPOS: Record<Tipo, string> = { router: 'Router', phone: 'Móvil' };",
  "const ICONOS = [{ icon: 'a', label: 'Salón' }, { icon: 'b', label: 'Otra cosa' }];",
  "export const WIDGETS = [{ id: 'x', title: 'Acciones rápidas', span: 2 }];",
  "const CLAVES: Record<Tipo, TranslationKey> = { router: 'device.typeName.router' };",
  "const CLASES: Record<Estado, string> = { on: 'border-success text-success' };",
  "const V = cva('inline-flex items-center', { variants: { a: { b: 'x' } } });",
  "const URL_EJEMPLO = { label: 'https://example.com/ruta' };",
  "function f() { const DENTRO: Record<A, string> = { a: 'Texto dentro de función' }; }",
  "const ID = { id: 'sistema' };",
].join('\n');

describe('constantes de módulo con copy ya escrito', () => {
  it('el barrido encuentra el árbol', () => {
    expect(ficheros().length).toBeGreaterThan(100);
  });

  it('el detector sigue detectando, con su línea (control positivo)', () => {
    expect(
      copyEnConstantes('muestra.ts', MUESTRA).map((h) => `${h.linea}:${h.via}:${h.valor}`),
    ).toEqual([
      '1:Record<…, string>:Router',
      '1:Record<…, string>:Móvil',
      '2:propiedad de copy:Salón',
      '2:propiedad de copy:Otra cosa',
      '3:propiedad de copy:Acciones rápidas',
    ]);
  });

  it('ninguna constante de módulo guarda copy ya escrito', () => {
    const culpables = escanear()
      .filter(({ nombre, h }) => !esLegitimo(nombre, h.valor))
      .map(({ nombre, h }) => `${nombre}:${h.linea}  «${h.valor}»  (${h.via})`);
    expect(
      culpables,
      'Una constante de módulo se evalúa al importar: el texto queda congelado con el ' +
        'idioma de ese momento. Guarda la CLAVE (`Record<X, TranslationKey>`) y resuélvela ' +
        'con `t()` al pintar. Si NO es copy (marca, id interno), añádelo a `MARCAS` o ' +
        '`INTERNOS` con el motivo.',
    ).toEqual([]);
  });

  it('las listas de marcas e internos no tienen entradas obsoletas', () => {
    const hallazgos = escanear();
    const valores = new Set(hallazgos.map(({ h }) => h.valor));
    const ficherosVistos = new Set(hallazgos.map(({ nombre }) => nombre));
    const obsoletas = [
      ...Object.keys(MARCAS).filter((m) => !valores.has(m)),
      ...Object.keys(INTERNOS).filter((f) => !ficherosVistos.has(f)),
    ];
    expect(
      obsoletas,
      'Entradas de `MARCAS`/`INTERNOS` que ya no casan con ninguna constante: quítalas ' +
        '(una allowlist que sobra es permiso para volver a meter copy).',
    ).toEqual([]);
  });
});
