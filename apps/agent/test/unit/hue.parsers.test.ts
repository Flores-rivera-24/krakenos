import { describe, expect, it } from 'vitest';
import {
  buildLightUpdate,
  hexToXy,
  kelvinToMirek,
  lightToIotDevice,
  mirekToKelvin,
  parseLights,
  xyToHex,
} from '../../src/iot/hue.parsers.js';

describe('conversión de color CIE xy ↔ sRGB', () => {
  it('mapea rojo a su cromaticidad Hue y vuelve a rojo', () => {
    const { x, y } = hexToXy('#ff0000');
    expect(x).toBeCloseTo(0.64, 1);
    expect(y).toBeCloseTo(0.33, 1);
    const hex = xyToHex(x, y);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    // El canal rojo domina sobre verde/azul.
    const n = parseInt(hex.slice(1), 16);
    expect((n >> 16) & 0xff).toBeGreaterThan((n >> 8) & 0xff);
    expect((n >> 16) & 0xff).toBeGreaterThan(n & 0xff);
  });

  it('tolera hex inválido (cae a blanco D65)', () => {
    expect(hexToXy('nope')).toEqual({ x: 0.3127, y: 0.329 });
  });
});

describe('temperatura de color', () => {
  it('convierte mirek ↔ Kelvin y acota el rango del bridge', () => {
    expect(mirekToKelvin(370)).toBe(2703);
    expect(kelvinToMirek(2700)).toBe(370);
    expect(kelvinToMirek(100000)).toBe(153); // acotado
  });
});

describe('lightToIotDevice / parseLights', () => {
  const lightColor = {
    id: 'abc-123',
    metadata: { name: 'Foco salón' },
    on: { on: true },
    dimming: { brightness: 80 },
    color: { xy: { x: 0.64, y: 0.33 } },
    color_temperature: { mirek: null, mirek_valid: false },
  };
  const lightWhite = {
    id: 'def-456',
    metadata: { name: 'Foco blanco' },
    on: { on: false },
    dimming: { brightness: 40 },
    color_temperature: { mirek: 370, mirek_valid: true },
  };

  it('mapea una luz de color (hex) y otra blanca (Kelvin)', () => {
    const color = lightToIotDevice(lightColor)!;
    expect(color).toMatchObject({ id: 'abc-123', name: 'Foco salón', kind: 'light', on: true, brightness: 80 });
    expect(color.color!.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(color.color!.temperatureK).toBeNull();

    const white = lightToIotDevice(lightWhite)!;
    expect(white.color).toEqual({ hex: null, temperatureK: 2703 });
  });

  it('parseLights descarta entradas sin id', () => {
    expect(parseLights([lightColor, { metadata: {} }])).toHaveLength(1);
  });
});

describe('buildLightUpdate', () => {
  it('construye on/brillo/color/temperatura', () => {
    expect(buildLightUpdate({ on: true })).toEqual({ on: { on: true } });
    expect(buildLightUpdate({ brightness: 50 })).toEqual({ dimming: { brightness: 50 } });
    expect(buildLightUpdate({ color: { temperatureK: 2700 } })).toEqual({
      color_temperature: { mirek: 370 },
    });
    const colorBody = buildLightUpdate({ color: { hex: '#ff0000' } }) as { color: { xy: { x: number } } };
    expect(colorBody.color.xy.x).toBeCloseTo(0.64, 1);
  });
});
