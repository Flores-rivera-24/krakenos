import type { AccessPoint, WifiClient, WifiNetworkInfo } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { NetworksCard } from '@/components/wifi/NetworksCard';
import { useAuthStore } from '@/store/auth.store';

const APS: AccessPoint[] = [
  { id: 'ap-salon', name: 'AP Salón', model: 'Pro', ip: '192.168.1.2', online: true, networkCount: 2 },
];
const NETS: WifiNetworkInfo[] = [
  { id: 'net-1', apId: 'ap-salon', ssid: 'KrakenOS', band: '5GHz', security: 'wpa2/wpa3', enabled: true, hidden: false, isGuest: false, clientCount: 1 },
];
const CLIENTS: WifiClient[] = [
  { mac: 'aa:bb:cc:dd:ee:ff', hostname: 'laptop', ip: '192.168.1.42', signalDbm: -50 },
];

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('NetworksCard', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/wifi/access-points') return Promise.resolve(APS);
      if (path === '/wifi/networks') return Promise.resolve(NETS);
      return Promise.resolve(CLIENTS); // /wifi/networks/:id/clients
    });
    apiMock.put.mockReset().mockResolvedValue({ ...NETS[0], enabled: false });
  });

  it('muestra access points y redes', async () => {
    setRole('admin');
    render(<NetworksCard />);
    await waitFor(() => expect(screen.getAllByText(/AP Salón/).length).toBeGreaterThan(0));
    expect(screen.getByText('KrakenOS')).toBeInTheDocument();
    expect(screen.getByText('5GHz')).toBeInTheDocument();
  });

  it('abre el modal de clientes al pulsar el contador', async () => {
    setRole('admin');
    render(<NetworksCard />);
    await screen.findByText('KrakenOS');

    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(await screen.findByText(/Clientes ·/)).toBeInTheDocument();
    expect(screen.getByText('laptop')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/wifi/networks/net-1/clients');
  });

  it('un admin puede alternar una red (PUT)', async () => {
    setRole('admin');
    render(<NetworksCard />);
    await screen.findByText('KrakenOS');

    fireEvent.click(screen.getByRole('switch'));
    expect(apiMock.put).toHaveBeenCalledWith('/wifi/networks/net-1', { enabled: false });
  });
});
