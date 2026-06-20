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

  it('ignora valores no positivos o no finitos', () => {
    rateLimitStore.update(25);
    rateLimitStore.update(0);
    rateLimitStore.update(-5);
    rateLimitStore.update(Number.NaN);
    expect(rateLimitStore.getCurrent()).toBe(25);
  });
});
