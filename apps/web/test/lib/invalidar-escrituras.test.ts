import { describe, expect, it } from 'vitest';
import { fuentes } from './_fuentes';

/**
 * Gate: quien escribe sobre escenas, habitaciones o aparatos IoT invalida la caché
 * compartida de esa lectura (`lib/resources.ts`).
 *
 * `invalidarEscenas`/`invalidarIot`/`invalidarHabitaciones` existían y nadie las
 * llamaba: tras crear una escena, el dashboard seguía sin mostrarla hasta 5 s. Se
 * deriva del árbol, tolera que Prettier parta la llamada y mira código, no
 * comentarios. Es una comprobación por fichero (el fichero que escribe nombra la
 * invalidación); que se llame tras el ÉXITO y no antes lo prueba
 * `invalidar-al-escribir.test.tsx`.
 */
const ESCRITURA = (ruta: string) =>
  new RegExp(String.raw`\bapi\s*\.\s*(?:post|patch|put|del)\s*(?:<[^()]*?>)?\s*\(\s*['"\`]${ruta}`);

const REGLAS = [
  // `/scenes/capture` solo LEE el estado actual: no escribe nada.
  { escribe: ESCRITURA(String.raw`/scenes(?!/capture)`), debeLlamar: 'invalidarEscenas' },
  { escribe: ESCRITURA('/rooms'), debeLlamar: 'invalidarHabitaciones' },
  { escribe: ESCRITURA('/iot/(?:devices|tuya|matter)'), debeLlamar: 'invalidarIot' },
];

describe('las escrituras invalidan su caché compartida', () => {
  const codigo = fuentes();

  it('encuentra el árbol: si el recorrido se rompe, el gate no pasa en vacío', () => {
    expect(codigo.length).toBeGreaterThan(100);
    // Control positivo: hay escritores de cada recurso.
    for (const r of REGLAS) {
      expect(codigo.filter((f) => r.escribe.test(f.codigo)).length).toBeGreaterThan(0);
    }
  });

  it('todo fichero que escribe llama a la invalidación de su recurso', () => {
    const culpables = REGLAS.flatMap((r) =>
      codigo
        .filter((f) => r.escribe.test(f.codigo))
        .filter((f) => !new RegExp(String.raw`\b${r.debeLlamar}\b`).test(f.codigo))
        .map((f) => `${f.nombre} escribe y no llama a ${r.debeLlamar}`),
    );
    expect(culpables).toEqual([]);
  });

  it('el patrón ve la escritura partida por Prettier y no confunde la captura', () => {
    expect(ESCRITURA('/rooms').test("api.post<Room>('/rooms', body)")).toBe(true);
    expect(ESCRITURA('/rooms').test('api\n  .patch<Room>(\n  `/rooms/${id}`')).toBe(true);
    expect(ESCRITURA('/scenes(?!/capture)').test("api.post<A[]>('/scenes/capture', b)")).toBe(
      false,
    );
    expect(ESCRITURA('/rooms').test("api.get('/rooms')")).toBe(false);
  });
});
