import type { GuestNetwork, WifiNetwork } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { WifiPage } from '@/pages/WifiPage';
import { useAuthStore } from '@/store/auth.store';

const WIFI: WifiNetwork = {
  ssid: 'KrakenOS', enabled: true, band: '5GHz', security: 'wpa2/wpa3', hidden: false, updatedAt: '',
};
const GUEST: GuestNetwork = {
  ssid: 'KrakenOS-Invitados', enabled: false, clientIsolation: true, bandwidthLimitMbps: 50, updatedAt: '',
};

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('WifiPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) =>
      Promise.resolve(path === '/wifi' ? WIFI : GUEST),
    );
  });

  it('carga ambas redes y muestra las dos tarjetas', async () => {
    setRole('admin');
    render(<WifiPage />);

    await waitFor(() => expect(screen.getByText('Red principal')).toBeInTheDocument());
    expect(screen.getByText('Red de invitados')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/wifi');
    expect(apiMock.get).toHaveBeenCalledWith('/wifi/guest');
  });

  it('un admin ve la indicación de edición', async () => {
    setRole('admin');
    render(<WifiPage />);
    expect(await screen.findByText(/Gestiona tu red principal/)).toBeInTheDocument();
  });

  it('un viewer ve el aviso de solo lectura', async () => {
    setRole('viewer');
    render(<WifiPage />);
    expect(await screen.findByText(/Solo lectura/)).toBeInTheDocument();
  });

  it('muestra error si la carga falla', async () => {
    setRole('viewer');
    apiMock.get.mockRejectedValue(new Error('boom'));
    render(<WifiPage />);
    expect(await screen.findByText(/No se pudo cargar la configuración WiFi/)).toBeInTheDocument();
  });
});
