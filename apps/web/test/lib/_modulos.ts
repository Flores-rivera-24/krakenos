import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { SRC, ficheros } from './_fuentes';

/**
 * El grafo de módulos de `src/`, derivado del código (AST), para los gates que
 * necesitan saber **quién carga a quién**: qué cae en el bundle de arranque y qué
 * en un chunk perezoso. Lo usa `catalogo-fragmentos.test.ts`.
 *
 * Lee código, no comentarios (el AST no tiene comentarios), y tolera imports
 * partidos en varias líneas por el formateador. No resuelve nada que no sea un
 * especificador literal: un `import(variable)` no se ve, y eso es una limitación
 * declarada, no un hallazgo.
 */

/** Lo que una fuente dice de sí misma, sin tocar el disco. Puro. */
export interface Analisis {
  /** Especificadores de imports/re-exports ESTÁTICOS **de valor** (los de solo tipos se borran al compilar). */
  estaticos: string[];
  /** Especificadores de `import('…')` literales: son la frontera de los chunks perezosos. */
  dinamicos: string[];
  /** Cadenas literales (y plantillas sin sustituciones) que NO son especificadores de import. */
  literales: Set<string>;
  /** Cabeza de cada plantilla con sustituciones (`audit.action.${x}` → `audit.action.`). */
  plantillas: Set<string>;
}

export function analizarFuente(codigo: string, nombre = 'x.tsx'): Analisis {
  const sf = ts.createSourceFile(
    nombre,
    codigo,
    ts.ScriptTarget.Latest,
    true,
    nombre.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const estaticos: string[] = [];
  const dinamicos: string[] = [];
  const literales = new Set<string>();
  const plantillas = new Set<string>();
  const visitar = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) {
      const soloTipos = n.importClause?.isTypeOnly === true;
      if (!soloTipos && ts.isStringLiteral(n.moduleSpecifier)) {
        estaticos.push(n.moduleSpecifier.text);
      }
      return;
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      if (!n.isTypeOnly && ts.isStringLiteral(n.moduleSpecifier)) {
        estaticos.push(n.moduleSpecifier.text);
      }
      return;
    }
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      dinamicos.push(n.arguments[0].text);
    }
    if (ts.isStringLiteralLike(n)) literales.add(n.text);
    if (ts.isTemplateExpression(n)) plantillas.add(n.head.text);
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return { estaticos, dinamicos, literales, plantillas };
}

/**
 * Claves del catálogo que una fuente NOMBRA: las que aparecen como cadena literal
 * y las que cuelgan del prefijo de una plantilla (`rooms.icon.${icono}` nombra
 * todas las `rooms.icon.*`). Nombrar una clave es lo que obliga a haber cargado su
 * fragmento, la llame `t()` ahí o la guarde en un mapa que otro fichero pinta.
 */
export function clavesNombradas(a: Analisis, claves: readonly string[]): Set<string> {
  const conjunto = new Set(claves);
  const nombradas = new Set<string>();
  for (const l of a.literales) if (conjunto.has(l)) nombradas.add(l);
  for (const cabeza of a.plantillas) {
    // Una plantilla sin punto (`px-${n}`) no puede ser una clave de catálogo.
    if (!cabeza.includes('.')) continue;
    for (const c of claves) if (c.startsWith(cabeza)) nombradas.add(c);
  }
  return nombradas;
}

/** Resuelve un especificador relativo o `@/` a un fichero de `src/`, o `null` si es de fuera. */
export function resolver(desde: string, especificador: string): string | null {
  let base: string;
  if (especificador.startsWith('@/')) base = join(SRC, especificador.slice(2));
  else if (especificador.startsWith('.')) base = join(dirname(desde), especificador);
  else return null;
  for (const c of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    base,
  ]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

export interface Modulo {
  ruta: string;
  analisis: Analisis;
  /** Imports estáticos de valor ya resueltos a ficheros de `src/`. */
  estaticos: string[];
  dinamicos: string[];
}

let cache: Map<string, Modulo> | null = null;

/** Todos los módulos de `src/`, analizados (se calcula una vez por fichero de test). */
export function modulos(): Map<string, Modulo> {
  if (cache) return cache;
  const mapa = new Map<string, Modulo>();
  for (const ruta of ficheros()) {
    const analisis = analizarFuente(readFileSync(ruta, 'utf8'), ruta);
    const aRutas = (espec: string[]): string[] =>
      espec.map((e) => resolver(ruta, e)).filter((r): r is string => r !== null);
    mapa.set(ruta, {
      ruta,
      analisis,
      estaticos: aRutas(analisis.estaticos),
      dinamicos: aRutas(analisis.dinamicos),
    });
  }
  cache = mapa;
  return mapa;
}

/** Ficheros que carga `entrada` por imports ESTÁTICOS (transitivos), ella incluida. */
export function cierreEstatico(mapa: Map<string, Modulo>, entrada: string): Set<string> {
  const visto = new Set<string>();
  const ir = (f: string): void => {
    if (visto.has(f)) return;
    const m = mapa.get(f);
    if (!m) return;
    visto.add(f);
    for (const s of m.estaticos) ir(s);
  };
  ir(entrada);
  return visto;
}

/** Ficheros a los que apunta algún `import()` literal: cada uno es la raíz de un chunk perezoso. */
export function raicesPerezosas(mapa: Map<string, Modulo>): Set<string> {
  const raices = new Set<string>();
  for (const m of mapa.values()) for (const d of m.dinamicos) raices.add(d);
  return raices;
}
