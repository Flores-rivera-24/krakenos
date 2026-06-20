import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWebAuthnSupported } from '@/lib/webauthn';

describe('isWebAuthnSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('devuelve false si window.PublicKeyCredential no existe', () => {
    // jsdom no define PublicKeyCredential por defecto.
    expect(isWebAuthnSupported()).toBe(false);
  });

  it('devuelve true si window.PublicKeyCredential existe', () => {
    vi.stubGlobal('PublicKeyCredential', class {});
    expect(isWebAuthnSupported()).toBe(true);
  });
});
