import { describe, expect, it } from 'vitest';
import {
  isWithinWindow,
  parseMaintenanceWindow,
} from '../../src/system/maintenance-window.js';

describe('parseMaintenanceWindow', () => {
  it('parsea "HH:MM-HH:MM" a minutos', () => {
    expect(parseMaintenanceWindow('02:00-04:00')).toEqual({ startMin: 120, endMin: 240 });
    expect(parseMaintenanceWindow('22:30-06:15')).toEqual({ startMin: 1350, endMin: 375 });
  });

  it('vacío/nulo → null (sin restricción)', () => {
    expect(parseMaintenanceWindow('')).toBeNull();
    expect(parseMaintenanceWindow('   ')).toBeNull();
    expect(parseMaintenanceWindow(null)).toBeNull();
    expect(parseMaintenanceWindow(undefined)).toBeNull();
  });

  it('formato inválido → null', () => {
    expect(parseMaintenanceWindow('2-4')).toBeNull();
    expect(parseMaintenanceWindow('25:00-04:00')).toBeNull();
    expect(parseMaintenanceWindow('02:60-04:00')).toBeNull();
    expect(parseMaintenanceWindow('mañana')).toBeNull();
  });

  it('inicio == fin → null (franja degenerada)', () => {
    expect(parseMaintenanceWindow('03:00-03:00')).toBeNull();
  });
});

describe('isWithinWindow', () => {
  const at = (h: number, m = 0) => new Date(2026, 6, 13, h, m);

  it('sin ventana (null) siempre permite', () => {
    expect(isWithinWindow(null, at(14))).toBe(true);
  });

  it('franja normal (02:00-04:00)', () => {
    const w = parseMaintenanceWindow('02:00-04:00');
    expect(isWithinWindow(w, at(3))).toBe(true);
    expect(isWithinWindow(w, at(2))).toBe(true); // inicio inclusivo
    expect(isWithinWindow(w, at(4))).toBe(false); // fin exclusivo
    expect(isWithinWindow(w, at(1, 59))).toBe(false);
    expect(isWithinWindow(w, at(14))).toBe(false);
  });

  it('franja que cruza medianoche (22:00-06:00)', () => {
    const w = parseMaintenanceWindow('22:00-06:00');
    expect(isWithinWindow(w, at(23))).toBe(true);
    expect(isWithinWindow(w, at(2))).toBe(true);
    expect(isWithinWindow(w, at(6))).toBe(false); // fin exclusivo
    expect(isWithinWindow(w, at(12))).toBe(false);
  });
});
