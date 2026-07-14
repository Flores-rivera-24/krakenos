import { describe, expect, it } from 'vitest';
import { asEnum } from '../../src/util/as-enum.js';

describe('asEnum (AUD-20)', () => {
  const ICONS = ['night', 'movie', 'scene'] as const;

  it('devuelve el valor si pertenece a la unión', () => {
    expect(asEnum('movie', ICONS, 'scene')).toBe('movie');
  });

  it('cae al fallback si el valor es legado/desconocido (el tipo no miente)', () => {
    expect(asEnum('legado-viejo', ICONS, 'scene')).toBe('scene');
    expect(asEnum('', ICONS, 'scene')).toBe('scene');
  });
});
