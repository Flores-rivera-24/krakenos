import { afterEach, describe, expect, it, vi } from 'vitest';
import { registrarServiceWorker, soportaServiceWorker } from '@/lib/pwa';

/**
 * US-234 (AUD3-24) — el service worker debe registrarse en el ARRANQUE. Antes el
 * único `register()` vivía dentro de `subscribeToPush()`, así que quien no
 * activaba notificaciones no tenía PWA.
 */
describe('registrarServiceWorker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  const conSoporte = (register: unknown) =>
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
      writable: true,
    });

  it('registra /sw.js en un contexto seguro', async () => {
    const register = vi.fn().mockResolvedValue({ scope: '/' });
    conSoporte(register);
    vi.stubGlobal('isSecureContext', true);

    await expect(registrarServiceWorker()).resolves.toEqual({ scope: '/' });
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('NO registra fuera de un contexto seguro y no lanza', async () => {
    // Es el caso real de la instalación por defecto: HTTP plano en una IP de LAN
    // (`HTTPS_ENABLED=false`). Sin contexto seguro no hay SW, ni push, ni passkeys.
    const register = vi.fn();
    conSoporte(register);
    vi.stubGlobal('isSecureContext', false);

    await expect(registrarServiceWorker()).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('un registro que falla degrada a web normal en vez de romper el arranque', async () => {
    conSoporte(vi.fn().mockRejectedValue(new Error('sin sw.js')));
    vi.stubGlobal('isSecureContext', true);

    await expect(registrarServiceWorker()).resolves.toBeNull();
  });

  it('sin soporte de service worker devuelve null', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    expect(soportaServiceWorker()).toBe(false);
    await expect(registrarServiceWorker()).resolves.toBeNull();
  });
});
