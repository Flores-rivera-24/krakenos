import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)) };
});
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { bootstrapSession } from '@/lib/session';
import { useAuthStore } from '@/store/auth.store';

const USER = { id: 'u1', email: 'a@b.c', displayName: 'A', role: 'admin' as const, createdAt: '', updatedAt: '' };

/** Reintentos instantáneos: los tests no esperan de verdad. */
const SIN_ESPERA = { sleep: async () => {}, retries: [0, 0, 0] as const };

describe('bootstrapSession (US-91)', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, tokens: null, lastRefreshFailure: null });
    apiMock.get.mockReset();
  });

  it('sin cookie de refresh válida devuelve false y no pide el usuario', async () => {
    // El agente respondió 401 → `refresh()` marca `expired`: no hay nada que reintentar.
    useAuthStore.setState({
      refresh: vi.fn().mockImplementation(async () => {
        useAuthStore.setState({ lastRefreshFailure: 'expired' });
        return false;
      }),
    });
    expect(await bootstrapSession(SIN_ESPERA)).toBe(false);
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('con cookie válida refresca el access y carga el usuario', async () => {
    useAuthStore.setState({ refresh: vi.fn().mockResolvedValue(true) });
    apiMock.get.mockResolvedValue(USER);

    expect(await bootstrapSession(SIN_ESPERA)).toBe(true);
    expect(apiMock.get).toHaveBeenCalledWith('/auth/status');
    expect(useAuthStore.getState().user).toEqual(USER);
  });

  it('si /auth/status falla tras el refresh, limpia la sesión y devuelve false', async () => {
    useAuthStore.setState({ user: USER, refresh: vi.fn().mockResolvedValue(true) });
    apiMock.get.mockRejectedValue(new Error('401'));

    expect(await bootstrapSession(SIN_ESPERA)).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().tokens).toBeNull();
  });

  /**
   * US-234 (AUD3-25) — el arranque de la PWA en el móvil ocurre justo cuando el
   * túnel todavía se está levantando, y el actualizador de US-190 reinicia el
   * agente a media sesión. Antes, el primer fallo de red mandaba al login.
   */
  describe('resistencia a la red (US-234)', () => {
    it('reintenta si el agente no responde y sigue adelante cuando vuelve', async () => {
      const refresh = vi
        .fn()
        .mockImplementationOnce(async () => {
          useAuthStore.setState({ lastRefreshFailure: 'unreachable' });
          return false;
        })
        .mockImplementationOnce(async () => {
          useAuthStore.setState({ lastRefreshFailure: 'unreachable' });
          return false;
        })
        .mockImplementationOnce(async () => {
          useAuthStore.setState({ lastRefreshFailure: null });
          return true;
        });
      useAuthStore.setState({ refresh });
      apiMock.get.mockResolvedValue(USER);

      expect(await bootstrapSession(SIN_ESPERA)).toBe(true);
      expect(refresh).toHaveBeenCalledTimes(3);
      expect(useAuthStore.getState().user).toEqual(USER);
    });

    it('un 401 NO se reintenta: reintentar no resucita una cookie caducada', async () => {
      const refresh = vi.fn().mockImplementation(async () => {
        useAuthStore.setState({ lastRefreshFailure: 'expired' });
        return false;
      });
      useAuthStore.setState({ refresh });

      expect(await bootstrapSession(SIN_ESPERA)).toBe(false);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('si el agente nunca responde, agota los reintentos y NO borra la sesión', async () => {
      const refresh = vi.fn().mockImplementation(async () => {
        useAuthStore.setState({ lastRefreshFailure: 'unreachable' });
        return false;
      });
      // Sesión previa en memoria (p. ej. otra pestaña ya autenticada).
      useAuthStore.setState({ refresh, user: USER });

      expect(await bootstrapSession(SIN_ESPERA)).toBe(false);
      expect(refresh).toHaveBeenCalledTimes(4); // intento inicial + 3 reintentos
      // Lo que importa: la sesión sobrevive para que un refresh posterior la recupere.
      expect(useAuthStore.getState().user).toEqual(USER);
    });

    it('espera entre reintentos con los tiempos configurados', async () => {
      const esperas: number[] = [];
      const refresh = vi.fn().mockImplementation(async () => {
        useAuthStore.setState({ lastRefreshFailure: 'unreachable' });
        return false;
      });
      useAuthStore.setState({ refresh });

      await bootstrapSession({
        sleep: async (ms) => {
          esperas.push(ms);
        },
        retries: [10, 20, 30],
      });

      expect(esperas).toEqual([10, 20, 30]); // backoff creciente y acotado
    });
  });
});
