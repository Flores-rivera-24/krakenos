import { beforeEach, describe, expect, it } from 'vitest';
import {
  BASE_LOCKOUT_MS,
  FAILURE_THRESHOLD,
  MAX_LOCKOUT_MS,
  RESET_AFTER_MS,
  lockoutMsForFailures,
  loginLockout,
} from '../../src/auth/login-lockout.js';

describe('login-lockout (US-77, F3)', () => {
  beforeEach(() => loginLockout.reset());

  it('no bloquea por debajo del umbral', () => {
    expect(lockoutMsForFailures(FAILURE_THRESHOLD - 1)).toBe(0);
    const email = 'a@krakenos.test';
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      expect(loginLockout.recordFailure(email, 1000)).toBe(0);
    }
    expect(loginLockout.retryAfterSec(email, 1000)).toBe(0);
  });

  it('bloquea al alcanzar el umbral y dobla la espera en cada fallo posterior', () => {
    expect(lockoutMsForFailures(FAILURE_THRESHOLD)).toBe(BASE_LOCKOUT_MS);
    expect(lockoutMsForFailures(FAILURE_THRESHOLD + 1)).toBe(BASE_LOCKOUT_MS * 2);
    expect(lockoutMsForFailures(FAILURE_THRESHOLD + 2)).toBe(BASE_LOCKOUT_MS * 4);
  });

  it('topa la espera en MAX_LOCKOUT_MS', () => {
    expect(lockoutMsForFailures(100)).toBe(MAX_LOCKOUT_MS);
  });

  it('retryAfterSec refleja el tiempo restante y vuelve a 0 al expirar', () => {
    const email = 'b@krakenos.test';
    const now = 10_000;
    for (let i = 0; i < FAILURE_THRESHOLD; i++) loginLockout.recordFailure(email, now);
    expect(loginLockout.retryAfterSec(email, now)).toBe(BASE_LOCKOUT_MS / 1000);
    // a mitad del bloqueo
    expect(loginLockout.retryAfterSec(email, now + BASE_LOCKOUT_MS / 2)).toBe(BASE_LOCKOUT_MS / 2000);
    // tras expirar (pero dentro de RESET): ya no bloquea
    expect(loginLockout.retryAfterSec(email, now + BASE_LOCKOUT_MS + 1)).toBe(0);
  });

  it('recordSuccess limpia el contador de la cuenta', () => {
    const email = 'c@krakenos.test';
    for (let i = 0; i < FAILURE_THRESHOLD; i++) loginLockout.recordFailure(email, 1000);
    expect(loginLockout.retryAfterSec(email, 1000)).toBeGreaterThan(0);
    loginLockout.recordSuccess(email);
    expect(loginLockout.retryAfterSec(email, 1000)).toBe(0);
    // el siguiente fallo arranca de cero (sin bloqueo inmediato)
    expect(loginLockout.recordFailure(email, 1000)).toBe(0);
  });

  it('olvida el contador tras un periodo de inactividad', () => {
    const email = 'd@krakenos.test';
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) loginLockout.recordFailure(email, 1000);
    // un fallo mucho más tarde reinicia el contador a 1 (no acumula)
    expect(loginLockout.recordFailure(email, 1000 + RESET_AFTER_MS + 1)).toBe(0);
  });

  it('trata el email sin distinguir mayúsculas ni espacios', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) loginLockout.recordFailure('  User@Krakenos.test ', 1000);
    expect(loginLockout.retryAfterSec('user@krakenos.test', 1000)).toBeGreaterThan(0);
  });
});
