import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Utilidades comunes a los gates que se derivan del árbol de fuentes.
 *
 * Existe porque tres gates (`get-lista`, `errores-anunciados` y el de sondeos)
 * necesitan exactamente lo mismo —recorrer `src/` y mirar **código**, no
 * comentarios— y la última vez que cada uno se lo escribió por su cuenta salió
 * distinto: el de errores despojaba los comentarios y el de listas no, así que
 * **explicar la regla en un comentario delataba al fichero**. Un incentivo justo
 * al revés del que se buscaba, anotado como deuda antes de esta historia.
 */

export const SRC = join(process.cwd(), 'src');

/**
 * Nombre de un fichero de `src/` relativo a `src/` y SIEMPRE con «/» (también en Windows):
 * los gates comparan y citan nombres como `lib/use-polling.ts`. Es el único sitio que
 * normaliza; los gates llaman a esto y no a `slice`/`relative`.
 */
export function nombreDe(ruta: string): string {
  return ruta.slice(SRC.length + 1).replaceAll('\\', '/');
}

/** Todos los `.ts`/`.tsx` bajo `src/`, en rutas absolutas. */
export function ficheros(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) return ficheros(ruta);
    return /\.tsx?$/.test(entrada) ? [ruta] : [];
  });
}

/**
 * El fichero sin sus comentarios.
 *
 * Un gate que no distingue el código de su documentación obliga a no documentar:
 * es corriente que el sitio correcto para explicar por qué **no** se usa un
 * patrón sea justo al lado del patrón citado.
 */
export function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Como `sinComentarios`, pero **conserva los saltos de línea** de lo que quita,
 * de modo que el número de línea de un hallazgo coincide con el del fichero real.
 * `sinComentarios` los pierde dentro de un comentario de bloque: vale para
 * contar, no para decirle a alguien en qué línea mirar.
 */
export function sinComentariosConLineas(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ''));
}

export interface Fuente {
  /** Ruta relativa a `src/`, que es como se nombra en el mensaje de fallo. */
  nombre: string;
  /** El código, ya sin comentarios. */
  codigo: string;
}

/** Las fuentes de `src/`, listas para escanear. */
export function fuentes(): Fuente[] {
  return ficheros().map((ruta) => ({
    nombre: nombreDe(ruta),
    codigo: sinComentarios(readFileSync(ruta, 'utf8')),
  }));
}
