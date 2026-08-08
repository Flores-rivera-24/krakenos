import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { ApiRequestError, api } from '@/lib/api';

/**
 * Listas con la forma comprobada (US-267).
 *
 * `api.get<T[]>()` es un cast y no comprueba nada en runtime, así que una
 * respuesta 200 con otra forma se asignaba al estado y reventaba después, en el
 * `.map()` de un componente sin relación con la causa. `api.getList()` falla
 * donde está el problema.
 */

function respuesta(cuerpo: unknown, status = 200) {
  return Promise.resolve({
    status,
    ok: status < 400,
    text: () => Promise.resolve(cuerpo === undefined ? '' : JSON.stringify(cuerpo)),
  } as Response);
}

describe('api.getList', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('devuelve la lista cuando el servidor manda una lista', async () => {
    fetchMock.mockReturnValue(respuesta([{ id: 'a' }, { id: 'b' }]));
    await expect(api.getList<{ id: string }>('/cosas')).resolves.toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
  });

  it('una lista vacía es un dato válido, no un error', async () => {
    fetchMock.mockReturnValue(respuesta([]));
    await expect(api.getList('/cosas')).resolves.toEqual([]);
  });

  it.each([
    ['un objeto', {}],
    ['null', null],
    ['un número', 7],
    ['una cadena', 'vale'],
    ['un objeto con forma de error', { code: 'X', message: 'y' }],
  ])('%s NO se entrega como lista: lanza', async (_caso, cuerpo) => {
    fetchMock.mockReturnValue(respuesta(cuerpo));
    await expect(api.getList('/cosas')).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('el error nombra el problema con un código propio', async () => {
    fetchMock.mockReturnValue(respuesta({}));
    // Sin código propio, esto se confundiría con un fallo del servidor y quien
    // lea un informe de soporte buscaría el problema en el sitio equivocado.
    await expect(api.getList('/cosas')).rejects.toMatchObject({
      body: { code: 'RESPUESTA_NO_ES_LISTA' },
    });
  });

  it('NO degrada a lista vacía', async () => {
    // Devolver `[]` diría «no tienes nada» cuando lo que pasa es que no
    // entendemos la respuesta: la mentira más cómoda y la más difícil de ver.
    fetchMock.mockReturnValue(respuesta(null));
    await expect(api.getList('/cosas')).rejects.toBeTruthy();
  });

  it('una respuesta 204 sin cuerpo tampoco pasa por lista', async () => {
    fetchMock.mockReturnValue(respuesta(undefined, 204));
    await expect(api.getList('/cosas')).rejects.toBeInstanceOf(ApiRequestError);
  });
});

/**
 * Gate: el invariante lo tiene que sostener el código, no la memoria de quien
 * escribe la siguiente pantalla. Mismo patrón que el barrido de `safeFetch` en
 * el agente: se deriva del árbol y falla **nombrando el fichero**.
 */
describe('ninguna lista se pide con el cast', () => {
  const SRC = join(process.cwd(), 'src');

  function ficheros(dir: string): string[] {
    return readdirSync(dir).flatMap((entrada) => {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) return ficheros(ruta);
      return /\.tsx?$/.test(entrada) ? [ruta] : [];
    });
  }

  const fuentes = ficheros(SRC);

  it('encuentra el árbol: si el recorrido se rompe, el gate no pasa en vacío', () => {
    expect(fuentes.length).toBeGreaterThan(100);
  });

  it('no queda ningún `api.get<T[]>`', () => {
    const culpables = fuentes
      .filter((ruta) => {
        // El propio `api.ts` lo nombra en su comentario, explicando por qué no
        // se usa: es documentación, no una llamada.
        if (ruta.endsWith(join('lib', 'api.ts'))) return false;
        return /api\.get<[A-Za-z_][\w]*\[\]>/.test(readFileSync(ruta, 'utf8'));
      })
      .map((ruta) => ruta.slice(SRC.length + 1));
    expect(culpables).toEqual([]);
  });
});
