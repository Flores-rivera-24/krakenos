import type { GuestNetwork, WifiNetwork } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/wifi') return Promise.resolve(WIFI);
      if (path === '/wifi/guest') return Promise.resolve(GUEST);
      return Promise.resolve([]); // /wifi/access-points, /wifi/networks
    });
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

  it('muestra pistas de ayuda contextual junto a la jerga WiFi (US-150)', async () => {
    setRole('admin');
    render(<WifiPage />);
    await screen.findByText('Red principal');
    expect(screen.getByRole('button', { name: '¿Qué es SSID?' })).toBeInTheDocument();
  });

  it('un viewer ve el aviso de solo lectura', async () => {
    setRole('viewer');
    render(<WifiPage />);
    expect(await screen.findByText(/Solo lectura/)).toBeInTheDocument();
  });

  it('muestra un banner role="alert" de conexión si la carga falla (red)', async () => {
    setRole('viewer');
    apiMock.get.mockRejectedValue(new Error('boom')); // sin respuesta = fallo de red
    render(<WifiPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar con el servidor/);
  });

  it('muestra el estado vacío honesto sin configuración (US-93)', async () => {
    setRole('admin');
    apiMock.get.mockReset().mockImplementation((path: string) => {
      // Sin red principal ni de invitados; el resto (access-points/networks) son arrays.
      if (path === '/wifi' || path === '/wifi/guest') return Promise.resolve(null);
      return Promise.resolve([]);
    });
    render(
      <MemoryRouter>
        <WifiPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Aún no hay configuración WiFi disponible/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Conecta tu router/ })).toHaveAttribute(
      'href',
      '/connect',
    );
  });
});
