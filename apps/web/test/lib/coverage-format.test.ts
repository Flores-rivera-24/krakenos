import { describe, expect, it } from 'vitest';
import {
  formatDbm,
  heatmapRgba,
  SIGNAL_QUALITY_LABELS,
  WALL_MATERIAL_LABELS,
} from '@/lib/coverage-format';

describe('heatmapRgba', () => {
  it('es completamente transparente cuando no hay dato', () => {
    expect(heatmapRgba(null)).toBe('rgba(0,0,0,0)');
  });

  it('es verdoso con señal fuerte', () => {
    const [r, g, b] = heatmapRgba(-40).match(/\d+/g)!.map(Number);
    expect(g).toBeGreaterThan(r!);
    expect(g).toBeGreaterThan(b!);
  });

  it('es rojizo con señal débil', () => {
    const [r, g, b] = heatmapRgba(-90).match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(g!);
    expect(r).toBeGreaterThan(b!);
  });

  it('respeta el alpha indicado', () => {
    expect(heatmapRgba(-40, 0.3)).toBe('rgba(63,185,80,0.3)');
    expect(heatmapRgba(-40)).toBe('rgba(63,185,80,0.55)');
  });

  it('el canal rojo crece monótonamente al empeorar la señal', () => {
    const dbms = [-50, -55, -60, -67, -73, -80, -85];
    const reds = dbms.map((dbm) => Number(heatmapRgba(dbm).match(/\d+/g)![0]));
    for (let i = 1; i < reds.length; i++) {
      expect(reds[i]).toBeGreaterThanOrEqual(reds[i - 1]!);
    }
  });

  it('el canal verde decrece monótonamente al empeorar la señal desde el óptimo', () => {
    const dbms = [-50, -55, -60, -67, -73, -80, -85];
    const greens = dbms.map((dbm) => Number(heatmapRgba(dbm).match(/\d+/g)![1]));
    for (let i = 1; i < greens.length; i++) {
      expect(greens[i]).toBeLessThanOrEqual(greens[i - 1]!);
    }
  });

  it('clampa por encima del mejor umbral y por debajo del peor', () => {
    expect(heatmapRgba(-30)).toBe(heatmapRgba(-50));
    expect(heatmapRgba(-95)).toBe(heatmapRgba(-80));
  });
});

describe('formatDbm', () => {
  it('formatea un valor numérico redondeado con la unidad', () => {
    expect(formatDbm(-58)).toBe('-58 dBm');
    expect(formatDbm(-58.6)).toBe('-59 dBm');
  });

  it('usa em dash cuando no hay dato', () => {
    expect(formatDbm(null)).toBe('—');
  });
});

describe('etiquetas en español', () => {
  it('cubre todos los materiales de pared', () => {
    expect(WALL_MATERIAL_LABELS.drywall).toBe('Pladur/tabique');
    expect(WALL_MATERIAL_LABELS.wood).toBe('Madera');
    expect(WALL_MATERIAL_LABELS.glass).toBe('Cristal');
    expect(WALL_MATERIAL_LABELS.brick).toBe('Ladrillo');
    expect(WALL_MATERIAL_LABELS.concrete).toBe('Hormigón');
    expect(WALL_MATERIAL_LABELS.metal).toBe('Metal');
  });

  it('cubre todas las categorías de calidad de señal', () => {
    expect(SIGNAL_QUALITY_LABELS.excellent).toBe('Excelente');
    expect(SIGNAL_QUALITY_LABELS.good).toBe('Buena');
    expect(SIGNAL_QUALITY_LABELS.fair).toBe('Aceptable');
    expect(SIGNAL_QUALITY_LABELS.weak).toBe('Débil');
    expect(SIGNAL_QUALITY_LABELS.none).toBe('Sin señal');
  });
});
