import { beforeEach, describe, expect, it } from 'vitest';
import { mfaTokenStore } from '../../src/auth/mfa-token-store.js';

const FUTURE = () => Date.now() + 120_000;

describe('mfa-token-store (US-88)', () => {
  beforeEach(() => mfaTokenStore.reset());

  it('consume devuelve true la primera vez y false en el replay', () => {
    expect(mfaTokenStore.consume('jti-1', FUTURE())).toBe(true);
    expect(mfaTokenStore.consume('jti-1', FUTURE())).toBe(false);
    expect(mfaTokenStore.consume('jti-1', FUTURE())).toBe(false);
  });

  it('jti distintos son independientes', () => {
    expect(mfaTokenStore.consume('jti-a', FUTURE())).toBe(true);
    expect(mfaTokenStore.consume('jti-b', FUTURE())).toBe(true);
    expect(mfaTokenStore.consume('jti-a', FUTURE())).toBe(false);
  });

  it('purga entradas ya expiradas (no crece sin límite)', () => {
    // Consumido con expiración en el pasado: una nueva llamada lo purga y vuelve a true.
    expect(mfaTokenStore.consume('jti-exp', Date.now() - 1)).toBe(true);
    expect(mfaTokenStore.consume('jti-exp', FUTURE())).toBe(true);
  });

  it('reset vacía el registro', () => {
    expect(mfaTokenStore.consume('jti-r', FUTURE())).toBe(true);
    mfaTokenStore.reset();
    expect(mfaTokenStore.consume('jti-r', FUTURE())).toBe(true);
  });
});
