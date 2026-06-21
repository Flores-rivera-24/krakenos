import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock }));

const browserMock = vi.hoisted(() => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: browserMock.startAuthentication,
  startRegistration: browserMock.startRegistration,
  WebAuthnError: class WebAuthnError extends Error {},
}));

import { completePasskeyLogin, isWebAuthnSupported } from '@/lib/webauthn';

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

describe('completePasskeyLogin (US-51)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('propaga el mfaToken al pedir opciones y al verificar', async () => {
    const options = { challenge: 'abc' };
    const assertion = { id: 'assertion-1' };
    const session = {
      user: { id: 'u1' },
      tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
    };
    apiMock.post.mockResolvedValueOnce({ available: true, options }).mockResolvedValueOnce(session);
    browserMock.startAuthentication.mockResolvedValue(assertion);

    const result = await completePasskeyLogin('user@krakenos.test', 'mfa-token-xyz');

    expect(result).toEqual(session);
    // El token efímero del primer factor se reenvía en ambos pasos (atadura US-51).
    expect(apiMock.post).toHaveBeenNthCalledWith(1, '/webauthn/authenticate/options', {
      email: 'user@krakenos.test',
      mfaToken: 'mfa-token-xyz',
    });
    expect(apiMock.post).toHaveBeenNthCalledWith(2, '/webauthn/authenticate/verify', {
      email: 'user@krakenos.test',
      mfaToken: 'mfa-token-xyz',
      response: assertion,
    });
  });

  it('lanza si el servidor responde que la passkey no está disponible', async () => {
    apiMock.post.mockResolvedValueOnce({ available: false });
    await expect(completePasskeyLogin('user@krakenos.test', 'mfa')).rejects.toThrow(
      'webauthn_unavailable',
    );
    expect(browserMock.startAuthentication).not.toHaveBeenCalled();
  });
});
