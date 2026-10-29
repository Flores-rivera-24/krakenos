import { describe, expect, it } from 'vitest';
import { fuentes, sinComentarios } from './_fuentes';

/**
 * Gate: ningún rótulo se pinta con la clase `uppercase` (`docs/copy-style.md`:
 * nunca MAYÚSCULAS salvo siglas).
 *
 * Las siglas ya se escriben en mayúsculas en el catálogo; forzarlas por CSS
 * convierte en grito cualquier rótulo, también los que mañana traduzca otro idioma.
 * Mira el código sin comentarios y la clase como palabra: `toUpperCase()` o la
 * palabra en un comentario no cuentan.
 */

/** Sin excepciones a propósito: una entrada exige su motivo por escrito. */
const EXCEPCIONES: Record<string, string> = {};

const CLASE = /(?<![\w-])uppercase(?![\w-])/;

function conClase(codigo: string): boolean {
  return CLASE.test(codigo);
}

describe('rótulos en caja normal', () => {
  it('control positivo: cuenta la clase en código y no un comentario ni toUpperCase()', () => {
    expect(conClase('<p className="x uppercase">')).toBe(true);
    expect(conClase('<p className="x uppercase tracking-wide">')).toBe(true);
    expect(conClase(sinComentarios('// uppercase\n/* uppercase */'))).toBe(false);
    expect(conClase('s.toUpperCase()')).toBe(false);
    expect(conClase('className="normal-case"')).toBe(false);
  });

  it('ningún fichero de src usa la clase uppercase', () => {
    const todas = fuentes();
    expect(todas.length).toBeGreaterThan(150);
    const culpables = todas
      .filter((f) => conClase(f.codigo))
      .map((f) => f.nombre)
      .filter((n) => !(n in EXCEPCIONES));
    expect(
      culpables,
      'Estos ficheros fuerzan MAYÚSCULAS con la clase `uppercase`; docs/copy-style.md: nunca MAYÚSCULAS salvo siglas (las siglas se escriben así en el catálogo).',
    ).toEqual([]);
  });
});
