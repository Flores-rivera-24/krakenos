import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ficheros, nombreDe, sinComentariosConLineas } from './_fuentes';

/**
 * Ningún componente pinta `err.body.message` tal cual: el texto del servidor
 * llega en español y a veces vacío, así que en otro idioma se ve el español y
 * con un cuerpo sin mensaje se ve un aviso en blanco. La única lectura legítima
 * es la de `describeError` (`lib/errors.ts`), que traduce por `code` y cae al
 * texto base de la acción.
 *
 * Mira `.body.message` / `.body?.message` (con el punto): un `body` local, como
 * el del cliente o el de `system-backup.ts`, es otra cosa.
 */
const CRUDO = /\.body\??\.message/;
const EXCEPCIONES: string[] = [];

function crudos(nombre: string, codigo: string): string[] {
  if (nombre === 'lib/errors.ts' || EXCEPCIONES.includes(nombre)) return [];
  return codigo
    .split('\n')
    .flatMap((linea, i) => (CRUDO.test(linea) ? [`${nombre}:${i + 1}`] : []));
}

describe('errores del servidor sin pintar crudos', () => {
  const todas = ficheros().map((ruta) => ({
    nombre: nombreDe(ruta),
    codigo: sinComentariosConLineas(readFileSync(ruta, 'utf8')),
  }));

  it('recorre el árbol: si el recorrido se rompe, no pasa en vacío', () => {
    expect(todas.length).toBeGreaterThan(200);
  });

  it('el detector cuenta (control positivo sintético)', () => {
    const muestra = [
      `setError(err instanceof ApiRequestError ? err.body.message : 'x');`,
      `const m = e.body?.message;`,
      `const n = body.message;`,
    ].join('\n');
    expect(crudos('muestra.tsx', muestra)).toEqual(['muestra.tsx:1', 'muestra.tsx:2']);
  });

  it('ningún componente lee body.message: va por describeError', () => {
    expect(todas.flatMap(({ nombre, codigo }) => crudos(nombre, codigo))).toEqual([]);
  });
});
