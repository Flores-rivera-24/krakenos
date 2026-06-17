import { describe, expect, it } from 'vitest';
import { DEVICE_TYPES, TYPE_LABELS } from '@/lib/devices';

describe('catálogo de tipos de dispositivo', () => {
  it('cada tipo tiene una etiqueta en español', () => {
    for (const type of DEVICE_TYPES) {
      expect(TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it('no hay etiquetas huérfanas (claves = DEVICE_TYPES)', () => {
    expect(Object.keys(TYPE_LABELS).sort()).toEqual([...DEVICE_TYPES].sort());
  });

  it('incluye los tipos esperados', () => {
    expect(DEVICE_TYPES).toContain('router');
    expect(DEVICE_TYPES).toContain('unknown');
    expect(TYPE_LABELS.iot).toBe('IoT');
  });
});
