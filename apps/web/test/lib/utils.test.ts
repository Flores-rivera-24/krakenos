import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('combina clases y filtra valores falsy', () => {
    const hidden = false;
    expect(cn('a', hidden && 'b', undefined, 'c')).toBe('a c');
  });

  it('resuelve conflictos de Tailwind (gana la última)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm text-red-500', 'text-lg')).toBe('text-red-500 text-lg');
  });

  it('acepta arrays y objetos condicionales', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c');
  });
});
