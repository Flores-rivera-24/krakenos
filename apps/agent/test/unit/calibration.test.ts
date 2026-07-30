import type { ApPlacement, Wall } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  calibratePathLossExponent,
  MAX_EXPONENT,
  MIN_EXPONENT,
  MIN_SAMPLES,
  type CalibrationSample,
} from '../../src/coverage/calibration.js';
import { rssiFromAp } from '../../src/coverage/propagation.js';

const AP: ApPlacement = { id: 'ap1', name: 'AP', x: 2, y: 2, txPowerDbm: 20, enabled: true };
const SIN_PAREDES: Wall[] = [];

/** Genera medidas SINTÉTICAS con un `n` conocido, para poder recuperarlo. */
function muestrasCon(n: number, aps: ApPlacement[] = [AP], walls: Wall[] = SIN_PAREDES): CalibrationSample[] {
  const out: CalibrationSample[] = [];
  for (let i = 0; i < 20; i++) {
    const x = 2 + i * 0.7;
    const y = 2 + (i % 5) * 0.9;
    let best = -Infinity;
    for (const ap of aps) {
      best = Math.max(best, rssiFromAp(x, y, ap, walls, { band: '5GHz', pathLossExponent: n }));
    }
    out.push({ x, y, rssiDbm: Math.round(best) });
  }
  return out;
}

describe('calibración del exponente de pérdida (US-237)', () => {
  it('recupera el `n` con el que se generaron las medidas', () => {
    for (const nReal of [2.0, 2.5, 3.5, 4.2]) {
      const res = calibratePathLossExponent({
        samples: muestrasCon(nReal),
        aps: [AP],
        walls: SIN_PAREDES,
        band: '5GHz',
      });
      expect(res).not.toBeNull();
      // Tolerancia holgada: las muestras van redondeadas a dBm enteros.
      expect(res!.pathLossExponent).toBeCloseTo(nReal, 1);
    }
  });

  it('mejora (o iguala) el error frente al `n` fijo de antes', () => {
    const res = calibratePathLossExponent({
      samples: muestrasCon(4.2),
      aps: [AP],
      walls: SIN_PAREDES,
      band: '5GHz',
    });
    expect(res).not.toBeNull();
    // Con n=3.0 fijo el error era grande; ajustado, casi nulo.
    expect(res!.rmseDb).toBeLessThan(res!.baselineRmseDb);
    expect(res!.rmseDb).toBeLessThan(1);
  });

  /**
   * Lo importante NO es ajustar siempre, sino **negarse** cuando el ajuste sería
   * ruido con pinta de calibración — que es peor que la constante, porque el
   * usuario se lo cree.
   */
  it('se NIEGA a calibrar con pocas muestras', () => {
    const pocas = muestrasCon(3.5).slice(0, MIN_SAMPLES - 1);
    expect(
      calibratePathLossExponent({ samples: pocas, aps: [AP], walls: SIN_PAREDES, band: '5GHz' }),
    ).toBeNull();
  });

  it('se niega sin APs (y ignora los deshabilitados)', () => {
    expect(
      calibratePathLossExponent({
        samples: muestrasCon(3),
        aps: [],
        walls: SIN_PAREDES,
        band: '5GHz',
      }),
    ).toBeNull();
    expect(
      calibratePathLossExponent({
        samples: muestrasCon(3),
        aps: [{ ...AP, enabled: false }],
        walls: SIN_PAREDES,
        band: '5GHz',
      }),
    ).toBeNull();
  });

  it('nunca devuelve un exponente fuera del rango físico', () => {
    // Medidas absurdas (todas iguales, sin relación con la distancia).
    const planas: CalibrationSample[] = Array.from({ length: 20 }, (_, i) => ({
      x: 2 + i,
      y: 2,
      rssiDbm: -60,
    }));
    const res = calibratePathLossExponent({
      samples: planas,
      aps: [AP],
      walls: SIN_PAREDES,
      band: '5GHz',
    });
    expect(res).not.toBeNull();
    expect(res!.pathLossExponent).toBeGreaterThanOrEqual(MIN_EXPONENT);
    expect(res!.pathLossExponent).toBeLessThanOrEqual(MAX_EXPONENT);
  });

  it('es determinista: misma entrada, mismo resultado', () => {
    const entrada = {
      samples: muestrasCon(2.8),
      aps: [AP],
      walls: SIN_PAREDES,
      band: '5GHz' as const,
    };
    expect(calibratePathLossExponent(entrada)).toEqual(calibratePathLossExponent(entrada));
  });

  it('tiene en cuenta las paredes al ajustar (no las mete dentro de `n`)', () => {
    const pared: Wall[] = [{ id: 'w1', x1: 5, y1: 0, x2: 5, y2: 10, material: 'brick' }];
    const res = calibratePathLossExponent({
      samples: muestrasCon(3.0, [AP], pared),
      aps: [AP],
      walls: pared,
      band: '5GHz',
    });
    expect(res).not.toBeNull();
    // Si la atenuación de la pared se colara en `n`, saldría muy por encima de 3.
    expect(res!.pathLossExponent).toBeCloseTo(3.0, 1);
  });
});
