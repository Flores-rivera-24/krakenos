import { describe, expect, it } from 'vitest';
import { fuentes } from './_fuentes';

/**
 * Gate: ninguna llamada del cliente lleva el prefijo `/api` escrito a mano.
 *
 * `request()` (`lib/api.ts`) ya antepone `/api` a la ruta, así que
 * `api.get('/api/weather')` pide `/api/api/weather` y recibe un 404. Así salió la
 * tarjeta «Tiempo exterior»: rota desde su entrega y con su test en verde, porque
 * el test mockeaba `api` y afirmaba la ruta **tal como estaba escrita** — consagraba
 * el fallo en vez de cazarlo. Un test sobre un mock no ve el contrato del mock;
 * esto lo mira en el árbol.
 *
 * Se deriva del árbol (no de una lista), tolera que Prettier parta la llamada en
 * varias líneas y mira código, no comentarios (mismas lecciones que
 * `get-lista.test.ts`). Las descargas por `fetch` directo (blobs autenticados) sí
 * escriben `/api` y no las mira: no pasan por `request()`.
 */
const RUTA_CON_PREFIJO =
  /\b(?:api\s*\.\s*(?:get|getList|post|patch|put|del)|request)\s*(?:<[^()]*?>)?\s*\(\s*['"`]\/api\//;

describe('las rutas del cliente no repiten el prefijo /api', () => {
  const codigo = fuentes();

  it('encuentra el árbol: si el recorrido se rompe, el gate no pasa en vacío', () => {
    expect(codigo.length).toBeGreaterThan(100);
  });

  it('ninguna llamada a `api.*` ni a `request` empieza por `/api/`', () => {
    const culpables = codigo
      .filter((f) => f.nombre !== 'lib/api.ts')
      .filter((f) => RUTA_CON_PREFIJO.test(f.codigo))
      .map((f) => f.nombre);
    expect(culpables).toEqual([]);
  });

  it('el patrón ve la forma que se escapó y la que parte Prettier', () => {
    expect(RUTA_CON_PREFIJO.test("await api.get<WeatherStatus>('/api/weather')")).toBe(true);
    expect(RUTA_CON_PREFIJO.test("api.put<WeatherStatus>('/api/weather', patch)")).toBe(true);
    expect(
      RUTA_CON_PREFIJO.test('api\n      .getList<Array<Regla>>(\n        `/api/x/${id}`,'),
    ).toBe(true);
    expect(RUTA_CON_PREFIJO.test("request<void>('/api/algo', { method: 'POST' })")).toBe(true);
    // Y no confunde con lo correcto ni con un `fetch` directo.
    expect(RUTA_CON_PREFIJO.test("api.get<WeatherStatus>('/weather')")).toBe(false);
    expect(RUTA_CON_PREFIJO.test("api.get('/apis-del-hogar')")).toBe(false);
    expect(RUTA_CON_PREFIJO.test("fetch('/api/cameras/1/recordings/2')")).toBe(false);
  });
});
