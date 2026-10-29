import { HOME_MODES } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { MODE_ICONS } from '@/lib/presence';

describe('lib/presence — iconos de modo', () => {
  it('cada modo del contrato tiene un icono propio', () => {
    expect(HOME_MODES.length).toBeGreaterThanOrEqual(3);
    const iconos = HOME_MODES.map((m) => MODE_ICONS[m]);
    for (const [i, icono] of iconos.entries()) expect(icono, HOME_MODES[i]).toBeDefined();
    expect(new Set(iconos).size).toBe(HOME_MODES.length);
  });
});
