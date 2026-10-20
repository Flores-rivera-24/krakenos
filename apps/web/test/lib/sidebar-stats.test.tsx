import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)) };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { useSidebarStats } from '@/lib/sidebar-stats';
import { useEstadosStore } from '@/lib/integration-states';
import { limpiarRecursos } from '@/lib/use-resource';
import { useAuthStore } from '@/store/auth.store';

/**
 * `GET /firewall/rules` es solo admin: la barra lateral lo sondeaba para todos y
 * cada ciclo de 8 s era un 403 seguro para viewer/member/kid/guest. Se aserta la
 * petición (lo observable), no el badge.
 */
function sesion(role: 'admin' | 'viewer' | 'member') {
  useAuthStore.setState({ user: { sub: 'u1', email: 'a@b.c', role } } as never);
}

describe('useSidebarStats y el rol', () => {
  beforeEach(() => {
    limpiarRecursos();
    apiMock.get.mockReset();
    apiMock.get.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/firewall/rules'
          ? [{ id: 'r1', enabled: true }]
          : path === '/iot/devices'
            ? []
            : {},
      ),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  it('un admin sondea las reglas y recibe su cuenta', async () => {
    sesion('admin');
    const { result } = renderHook(() => useSidebarStats(60_000, true));
    await waitFor(() => expect(result.current.firewallActive).toBe(1));
    expect(apiMock.get).toHaveBeenCalledWith('/firewall/rules');
  });

  it.each(['viewer', 'member'] as const)(
    'un %s NO pide /firewall/rules y no inventa un 0',
    async (rol) => {
      sesion(rol);
      const { result } = renderHook(() => useSidebarStats(60_000, true));
      // Espera a que las otras lecturas hayan salido, para no aseverar antes de tiempo.
      await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/iot/devices'));
      expect(apiMock.get).not.toHaveBeenCalledWith('/firewall/rules');
      expect(result.current.firewallActive).toBeNull();
    },
  );

  /**
   * La etiqueta «Driver» de la barra enseñaba siempre «—»: leía `health.driver` y `/health`
   * (público y mínimo, solo `{ status: 'ok' }`) nunca lo manda. Ahora sale del estado de
   * `/integrations/status`, una ruta autenticada. El fixture de `/health` es el REAL.
   */
  it('el estado del router sale del estado de integraciones, no de /health', async () => {
    sesion('admin');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'ok' }) }),
    );
    useEstadosStore.setState({ estados: { driver: 'demo' } });
    const { result } = renderHook(() => useSidebarStats(60_000, true));
    await waitFor(() => expect(result.current.online).toBe(true));
    expect(result.current.driverState).toBe('demo');
  });

  it('sin estado conocido, driverState es null (no inventa «sin configurar»)', async () => {
    sesion('admin');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    useEstadosStore.setState({ estados: null });
    const { result } = renderHook(() => useSidebarStats(60_000, true));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/iot/devices'));
    expect(result.current.driverState).toBeNull();
  });
});
