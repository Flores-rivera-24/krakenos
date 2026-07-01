import { describe, expect, it } from 'vitest';
import { MAX_HEATMAP_CELLS, resolveGrid } from '../../src/coverage/grid.js';

describe('resolveGrid — geometría acotada del heatmap', () => {
  it('deja la rejilla intacta cuando cabe bajo el tope', () => {
    expect(resolveGrid(10, 8, 0.5)).toEqual({ cols: 20, rows: 16, cellSizeM: 0.5 });
  });

  it('agranda la celda para no superar el tope en planos grandes', () => {
    const g = resolveGrid(300, 300, 0.5); // 600×600 = 360k > 250k sin acotar
    expect(g.cellSizeM).toBeGreaterThan(0.5);
    expect(g.cols * g.rows).toBeLessThanOrEqual(MAX_HEATMAP_CELLS);
  });

  it('respeta el tope de forma ESTRICTA incluso con dimensiones no divisibles', () => {
    for (const [w, h, cell] of [
      [300, 300, 0.1],
      [250, 300, 0.5],
      [300, 200, 0.25],
      [297, 133, 0.3],
    ] as const) {
      const g = resolveGrid(w, h, cell);
      expect(g.cols * g.rows).toBeLessThanOrEqual(MAX_HEATMAP_CELLS);
    }
  });

  it('blinda cellSizeM <= 0 (evita división por cero / bucle infinito)', () => {
    const g = resolveGrid(10, 8, 0);
    expect(g.cellSizeM).toBeGreaterThan(0);
    expect(g.cols).toBeGreaterThanOrEqual(1);
    expect(g.rows).toBeGreaterThanOrEqual(1);
  });

  it('clampa dimensiones cero o negativas a una rejilla mínima', () => {
    expect(resolveGrid(0, 0, 0.5)).toMatchObject({ cols: 1, rows: 1 });
    const neg = resolveGrid(-5, -5, 0.5);
    expect(neg.cols).toBe(1);
    expect(neg.rows).toBe(1);
  });
});
