import type { SurveySample } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { computeMeasuredHeatmap, idwEstimate } from '../../src/coverage/interpolation.js';

/** Crea una muestra de survey con valores por defecto sensatos. */
function sample(partial: Partial<SurveySample> & { x: number; y: number; rssiDbm: number }): SurveySample {
  return {
    id: 's1',
    scanId: 'scan1',
    createdAt: '2026-06-30T00:00:00.000Z',
    ...partial,
  };
}

describe('idwEstimate', () => {
  it('devuelve null sin muestras', () => {
    expect(idwEstimate(1, 1, [])).toBeNull();
  });

  it('con una muestra dentro del radio devuelve su valor', () => {
    const s = [{ x: 0, y: 0, rssiDbm: -55 }];
    // A 1 m de distancia, con una sola muestra el promedio ponderado es el propio valor.
    expect(idwEstimate(1, 0, s)).toBeCloseTo(-55, 6);
  });

  it('con una muestra fuera del radio devuelve null', () => {
    const s = [{ x: 0, y: 0, rssiDbm: -55 }];
    // maxRadiusM por defecto 4; a 5 m está fuera.
    expect(idwEstimate(5, 0, s)).toBeNull();
  });

  it('coincidencia exacta con una muestra devuelve su valor (sin dividir por cero)', () => {
    const s = [
      { x: 2, y: 3, rssiDbm: -42 },
      { x: 0, y: 0, rssiDbm: -90 },
    ];
    expect(idwEstimate(2, 3, s)).toBe(-42);
  });

  it('trata como coincidencia una distancia por debajo de 1e-9', () => {
    const s = [{ x: 0, y: 0, rssiDbm: -60 }];
    expect(idwEstimate(1e-12, 0, s)).toBe(-60);
  });

  it('promedia ponderadamente entre dos muestras equidistantes', () => {
    const s = [
      { x: 0, y: 0, rssiDbm: -40 },
      { x: 2, y: 0, rssiDbm: -80 },
    ];
    // Punto medio equidistante: media aritmética simple.
    expect(idwEstimate(1, 0, s)).toBeCloseTo(-60, 6);
  });

  it('pondera más la muestra más cercana', () => {
    const s = [
      { x: 0, y: 0, rssiDbm: -40 },
      { x: 4, y: 0, rssiDbm: -80 },
    ];
    // A 1 m de la primera y 3 m de la segunda: más cerca del -40.
    const est = idwEstimate(1, 0, s);
    expect(est).not.toBeNull();
    const value = est as number;
    expect(value).toBeGreaterThan(-60);
    expect(value).toBeLessThan(-40);
    // Cálculo exacto con power=2: w1=1, w2=1/9.
    const expected = (1 * -40 + (1 / 9) * -80) / (1 + 1 / 9);
    expect(value).toBeCloseTo(expected, 6);
  });

  it('el power aumenta el peso de la muestra cercana', () => {
    const s = [
      { x: 0, y: 0, rssiDbm: -40 },
      { x: 4, y: 0, rssiDbm: -80 },
    ];
    const low = idwEstimate(1, 0, s, 1) as number;
    const high = idwEstimate(1, 0, s, 4) as number;
    // Con más power, el resultado se acerca aún más al -40 (más grande).
    expect(high).toBeGreaterThan(low);
  });

  it('respeta un maxRadiusM personalizado', () => {
    const s = [{ x: 0, y: 0, rssiDbm: -55 }];
    expect(idwEstimate(2, 0, s, 2, 1)).toBeNull();
    expect(idwEstimate(2, 0, s, 2, 3)).toBeCloseTo(-55, 6);
  });

  it('devuelve la media exacta con muestras duplicadas en el mismo punto', () => {
    const s = [
      { x: 0, y: 0, rssiDbm: -50 },
      { x: 0, y: 0, rssiDbm: -70 },
    ];
    // A distancia igual (misma posición) la ponderación es idéntica → media.
    expect(idwEstimate(1, 0, s)).toBeCloseTo(-60, 6);
  });

  it('devuelve el valor de una muestra si el punto coincide aunque haya duplicadas', () => {
    const s = [
      { x: 0, y: 0, rssiDbm: -50 },
      { x: 0, y: 0, rssiDbm: -70 },
    ];
    // Coincide con la primera muestra listada.
    expect(idwEstimate(0, 0, s)).toBe(-50);
  });
});

describe('computeMeasuredHeatmap', () => {
  it('marca source measured y la geometría de la rejilla', () => {
    const hm = computeMeasuredHeatmap(10, 8, [], { band: '5GHz' });
    expect(hm.source).toBe('measured');
    expect(hm.band).toBe('5GHz');
    expect(hm.widthM).toBe(10);
    expect(hm.heightM).toBe(8);
    expect(hm.cellSizeM).toBe(0.5);
    // cols=ceil(10/0.5)=20, rows=ceil(8/0.5)=16.
    expect(hm.cols).toBe(20);
    expect(hm.rows).toBe(16);
    expect(hm.values).toHaveLength(20 * 16);
  });

  it('sin muestras todas las celdas son null', () => {
    const hm = computeMeasuredHeatmap(5, 5, [], { band: '2.4GHz' });
    expect(hm.values.every((v) => v === null)).toBe(true);
  });

  it('garantiza al menos 1 columna y 1 fila con dimensiones pequeñas', () => {
    const hm = computeMeasuredHeatmap(0, 0, [], { band: '5GHz' });
    expect(hm.cols).toBe(1);
    expect(hm.rows).toBe(1);
    expect(hm.values).toHaveLength(1);
  });

  it('respeta un cellSizeM personalizado en el cálculo de la rejilla', () => {
    const hm = computeMeasuredHeatmap(10, 10, [], { band: '5GHz', cellSizeM: 1 });
    expect(hm.cols).toBe(10);
    expect(hm.rows).toBe(10);
    expect(hm.cellSizeM).toBe(1);
  });

  it('interpola en el centro de la celda en orden row-major', () => {
    // Muestra en el centro de la celda (0,0) con cellSizeM=1 → centro (0.5, 0.5).
    const s = [sample({ x: 0.5, y: 0.5, rssiDbm: -33 })];
    const hm = computeMeasuredHeatmap(3, 3, s, { band: '5GHz', cellSizeM: 1 });
    // La celda (fila 0, col 0) coincide con la muestra → su valor exacto.
    expect(hm.values[0]).toBe(-33);
  });

  it('deja null las celdas cuyo centro supera el radio de la muestra', () => {
    const s = [sample({ x: 0.5, y: 0.5, rssiDbm: -33 })];
    const hm = computeMeasuredHeatmap(10, 10, s, { band: '5GHz', cellSizeM: 1, maxRadiusM: 1 });
    // Celda lejana (última) muy fuera del radio de 1 m.
    const last = hm.values[hm.values.length - 1];
    expect(last).toBeNull();
    // La celda de la muestra sí tiene valor.
    expect(hm.values[0]).toBe(-33);
  });

  it('las cotas de la leyenda reflejan el rango de las muestras', () => {
    const s = [
      sample({ x: 0.5, y: 0.5, rssiDbm: -40 }),
      sample({ x: 1.5, y: 0.5, rssiDbm: -75 }),
    ];
    const hm = computeMeasuredHeatmap(4, 4, s, { band: '5GHz', cellSizeM: 1 });
    expect(hm.minDbm).toBe(-75);
    expect(hm.maxDbm).toBe(-40);
  });

  it('usa un rango por defecto cuando no hay muestras', () => {
    const hm = computeMeasuredHeatmap(4, 4, [], { band: '5GHz' });
    expect(hm.minDbm).toBe(-90);
    expect(hm.maxDbm).toBe(-30);
  });
});
