import { describe, expect, it } from 'vitest';
import { detectMotion, isArmed, sensitivityToThresholds } from '../../src/cameras/motion.js';

/** Construye una huella WxH de gris uniforme con un bloque más claro opcional. */
function frame(size: number, base: number, block?: { start: number; len: number; value: number }): Uint8Array {
  const f = new Uint8Array(size).fill(base);
  if (block) for (let i = block.start; i < block.start + block.len; i++) f[i] = block.value;
  return f;
}

describe('detectMotion (US-186)', () => {
  const th = sensitivityToThresholds('medium');

  it('sin fotograma previo no hay movimiento (solo siembra)', () => {
    expect(detectMotion(null, frame(100, 40), th).motion).toBe(false);
  });

  it('dos fotogramas idénticos = sin movimiento', () => {
    const a = frame(100, 40);
    expect(detectMotion(a, frame(100, 40), th).motion).toBe(false);
  });

  it('un bloque que aparece localizado = movimiento', () => {
    const prev = frame(100, 40);
    const curr = frame(100, 40, { start: 20, len: 30, value: 220 });
    const r = detectMotion(prev, curr, th);
    expect(r.motion).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });

  it('un cambio de luz uniforme NO cuenta como movimiento (compensación de brillo)', () => {
    const prev = frame(100, 40);
    // Todos los píxeles suben 60 (se encendió una luz): desplazamiento global.
    const curr = frame(100, 100);
    expect(detectMotion(prev, curr, th).motion).toBe(false);
  });

  it('la sensibilidad alta detecta cambios que la baja ignora', () => {
    const prev = frame(1000, 40);
    // Cambio pequeño y localizado (2% de píxeles, +25 de gris).
    const curr = frame(1000, 40, { start: 0, len: 20, value: 65 });
    expect(detectMotion(prev, curr, sensitivityToThresholds('high')).motion).toBe(true);
    expect(detectMotion(prev, curr, sensitivityToThresholds('low')).motion).toBe(false);
  });

  it('tamaños distintos = sin movimiento (defensivo)', () => {
    expect(detectMotion(frame(50, 40), frame(100, 40), th).motion).toBe(false);
  });
});

describe('isArmed (US-186)', () => {
  // 2026-07-08 es miércoles (getDay()=3).
  const at = (h: number, m: number) => new Date(2026, 6, 8, h, m, 0);

  it('always/never son constantes', () => {
    expect(isArmed({ mode: 'always' }, at(3, 0))).toBe(true);
    expect(isArmed({ mode: 'never' }, at(3, 0))).toBe(false);
  });

  it('schedule: dentro de la ventana arma, fuera no', () => {
    const arming = { mode: 'schedule' as const, windows: [{ fromMinute: 9 * 60, toMinute: 17 * 60 }] };
    expect(isArmed(arming, at(10, 0))).toBe(true);
    expect(isArmed(arming, at(18, 0))).toBe(false);
  });

  it('schedule: ventana que cruza medianoche', () => {
    const arming = { mode: 'schedule' as const, windows: [{ fromMinute: 22 * 60, toMinute: 7 * 60 }] };
    expect(isArmed(arming, at(23, 0))).toBe(true);
    expect(isArmed(arming, at(3, 0))).toBe(true);
    expect(isArmed(arming, at(12, 0))).toBe(false);
  });

  it('schedule: respeta los días', () => {
    // day 3 = miércoles; ventana solo lunes (1).
    const arming = { mode: 'schedule' as const, windows: [{ fromMinute: 0, toMinute: 1439, days: [1] }] };
    expect(isArmed(arming, at(12, 0))).toBe(false);
    const monday = new Date(2026, 6, 6, 12, 0, 0); // 2026-07-06 lunes
    expect(isArmed(arming, monday)).toBe(true);
  });

  it('schedule sin ventanas ≡ nunca armada', () => {
    expect(isArmed({ mode: 'schedule', windows: [] }, at(12, 0))).toBe(false);
  });
});
