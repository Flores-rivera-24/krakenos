import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)) };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { useSidebarStats } from '@/lib/sidebar-stats';
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
});
