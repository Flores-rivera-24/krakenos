import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOGIN_RATE_LIMIT, rateLimitStore } from '../../src/plugins/rate-limit-store.js';

describe('rate-limit-store (US-47)', () => {
  beforeEach(() => rateLimitStore.reset());

  it('inicializa con el valor por defecto', () => {
    expect(rateLimitStore.getCurrent()).toBe(DEFAULT_LOGIN_RATE_LIMIT);
  });

  it('update(n) cambia el valor leído por getCurrent()', () => {
    rateLimitStore.update(25);
    expect(rateLimitStore.getCurrent()).toBe(25);
  });

  it('ignora valores no finitos (conserva el anterior)', () => {
    rateLimitStore.update(25);
    rateLimitStore.update(Number.NaN);
    rateLimitStore.update(Number.POSITIVE_INFINITY);
    expect(rateLimitStore.getCurrent()).toBe(25);
  });

  it('acota fuera de rango al mín/máx permitido (US-75, F5)', () => {
    rateLimitStore.update(99_999);
    expect(rateLimitStore.getCurrent()).toBe(1000); // máx
    rateLimitStore.update(0);
    expect(rateLimitStore.getCurrent()).toBe(1); // 0 → mín (nunca lockout total)
    rateLimitStore.update(-5);
    expect(rateLimitStore.getCurrent()).toBe(1); // negativo → mín
  });
});
