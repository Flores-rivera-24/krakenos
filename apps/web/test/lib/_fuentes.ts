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

export interface Fuente {
  /** Ruta relativa a `src/`, que es como se nombra en el mensaje de fallo. */
  nombre: string;
  /** El código, ya sin comentarios. */
  codigo: string;
}

/** Las fuentes de `src/`, listas para escanear. */
export function fuentes(): Fuente[] {
  return ficheros().map((ruta) => ({
    nombre: ruta.slice(SRC.length + 1),
    codigo: sinComentarios(readFileSync(ruta, 'utf8')),
  }));
}
