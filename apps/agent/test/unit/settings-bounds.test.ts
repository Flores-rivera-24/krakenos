import { describe, expect, it } from 'vitest';
import { SETTING_BOUNDS, boundFor, clampToBound } from '../../src/config/settings-bounds.js';

describe('settings-bounds (US-75, F5)', () => {
  it('boundFor devuelve la cota de las claves acotadas y undefined del resto', () => {
    expect(boundFor('accessTokenTtl')).toEqual(SETTING_BOUNDS.accessTokenTtl);
    expect(boundFor('loginRateLimit')).toEqual(SETTING_BOUNDS.loginRateLimit);
    expect(boundFor('timezone')).toBeUndefined();
    expect(boundFor('homeName')).toBeUndefined();
  });

  it('clampToBound acota por arriba y por abajo', () => {
    const b = { min: 60, max: 3600 };
    expect(clampToBound(100_000, b)).toBe(3600);
    expect(clampToBound(1, b)).toBe(60);
    expect(clampToBound(900, b)).toBe(900); // dentro de rango → sin cambios
    expect(clampToBound(60, b)).toBe(60);
    expect(clampToBound(3600, b)).toBe(3600);
  });

  it('clampToBound devuelve null para valores no finitos', () => {
    const b = { min: 1, max: 1000 };
    expect(clampToBound(Number.NaN, b)).toBeNull();
    expect(clampToBound(Number.POSITIVE_INFINITY, b)).toBeNull();
    expect(clampToBound(Number('abc'), b)).toBeNull();
  });

  it('el TTL de access nunca supera 1 h (preserva la vida corta)', () => {
    expect(SETTING_BOUNDS.accessTokenTtl.max).toBeLessThanOrEqual(3600);
    expect(SETTING_BOUNDS.loginRateLimit.min).toBeGreaterThanOrEqual(1);
  });

  it('scanIntervalSec está acotado (mín ≥ 5 s) para no degenerar en un bucle de setInterval', () => {
    expect(boundFor('scanIntervalSec')).toEqual(SETTING_BOUNDS.scanIntervalSec);
    expect(SETTING_BOUNDS.scanIntervalSec.min).toBeGreaterThanOrEqual(5);
    // Un valor fraccionario abusivo se acota al mínimo, no a ~1 ms.
    expect(clampToBound(0.001, SETTING_BOUNDS.scanIntervalSec)).toBe(
      SETTING_BOUNDS.scanIntervalSec.min,
    );
    // Un valor desbordado se acota al máximo (Node normalizaría delays enormes a 1 ms).
    expect(clampToBound(9_999_999_999, SETTING_BOUNDS.scanIntervalSec)).toBe(
      SETTING_BOUNDS.scanIntervalSec.max,
    );
  });
});
