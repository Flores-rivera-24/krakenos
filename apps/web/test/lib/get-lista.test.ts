import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fuentes } from './_fuentes';

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
  const codigo = fuentes();

  /**
   * El patrón, con dos correcciones que costaron caro (US-262):
   *
   *  - **Tolera el salto de línea.** El regex original era `api\.get<…>` sobre el
   *    texto crudo, y Prettier parte esa llamada en dos líneas en cuanto la
   *    cadena es larga: `api\n      .get<IotDevice[]>(…)`. US-267 dio por
   *    migrados los 33 sitios y **diez sobrevivieron** —justo los que el
   *    formateador había partido—, con el gate en verde. Es la misma omisión
   *    multilínea que ya se había pagado en el barrido de `safeFetch` del agente.
   *  - **Mira código, no comentarios** (`sinComentarios`), así que ya no hace
   *    falta exceptuar a mano el fichero que **explica** el patrón. La excepción
   *    por nombre era el síntoma: si hay que exculpar a la documentación, es que
   *    el gate está leyendo lo que no debe.
   */
  const CAST_DE_LISTA = /\bapi\s*\.\s*get\s*<[^>]*\[\]\s*>/;

  it('encuentra el árbol: si el recorrido se rompe, el gate no pasa en vacío', () => {
    expect(codigo.length).toBeGreaterThan(100);
  });

  it('no queda ningún `api.get<T[]>`, ni siquiera partido en dos líneas', () => {
    const culpables = codigo.filter((f) => CAST_DE_LISTA.test(f.codigo)).map((f) => f.nombre);
    expect(culpables).toEqual([]);
  });

  it('el patrón ve la llamada que Prettier parte en dos líneas', () => {
    // El gate se comprueba contra la forma que se le escapó, no solo contra la
    // que ya cazaba: si no, «arreglado» significa «sigue midiendo lo de antes».
    expect(CAST_DE_LISTA.test('const d = api\n      .get<IotDevice[]>(ruta)')).toBe(true);
    expect(CAST_DE_LISTA.test('api.get<IotDevice[]>(ruta)')).toBe(true);
    // Y no confunde con lo que sí es correcto.
    expect(CAST_DE_LISTA.test('api.getList<IotDevice>(ruta)')).toBe(false);
    expect(CAST_DE_LISTA.test('api.get<CameraSnapshot>(ruta)')).toBe(false);
  });
});
