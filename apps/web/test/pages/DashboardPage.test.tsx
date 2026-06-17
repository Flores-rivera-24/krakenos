import type { Device, GuestNetwork, SystemStats, WifiNetwork } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock }));

// Socket falso para subscribe() del store de inventario.
const fakeSocket = vi.hoisted(() => ({ connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { DashboardPage } from '@/pages/DashboardPage';
import { useInventoryStore } from '@/store/inventory.store';

const WIFI: WifiNetwork = {
  ssid: 'KrakenOS', enabled: true, band: '5GHz', security: 'wpa2/wpa3', hidden: false, updatedAt: '',
};
const GUEST: GuestNetwork = {
  ssid: 'KrakenOS-Invitados', enabled: false, clientIsolation: true, bandwidthLimitMbps: 50, updatedAt: '',
};
const STATS: SystemStats = {
  uptimeSeconds: 3600,
  cpu: { cores: 4, loadPercent: 20 },
  memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 4 * 1024 ** 3, usedPercent: 50 },
  timestamp: '2026-06-17T12:00:00.000Z',
};

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'd1', mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.1.10', hostname: 'macbook',
    label: null, notes: null, vendor: 'Apple', type: 'computer', isBlocked: false,
    online: true, sources: ['arp'], firstSeen: '', lastSeen: '', ...over,
  };
}

describe('DashboardPage', () => {
  beforeEach(() => {
    useInventoryStore.setState({ devices: {}, connected: true, recentEvents: [] });
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/wifi') return Promise.resolve(WIFI);
      if (path === '/wifi/guest') return Promise.resolve(GUEST);
      if (path === '/system/stats') return Promise.resolve(STATS);
      return Promise.resolve([]);
    });
  });

  it('muestra el título y el estado de conexión en tiempo real', async () => {
    render(<DashboardPage />);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('En tiempo real · conectado')).toBeInTheDocument());
  });

  it('renderiza las stat cards y carga el estado de la WiFi', async () => {
    render(<DashboardPage />);
    expect(screen.getByText('Dispositivos')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Red WiFi')).toBeInTheDocument();
    expect(screen.getByText('Invitados')).toBeInTheDocument();
    // El hint de la tarjeta WiFi aparece tras resolver /wifi.
    await waitFor(() => expect(screen.getByText('KrakenOS · 5GHz')).toBeInTheDocument());
    expect(apiMock.get).toHaveBeenCalledWith('/wifi');
    expect(apiMock.get).toHaveBeenCalledWith('/wifi/guest');
  });

  it('sin dispositivos muestra el estado vacío de las gráficas', () => {
    render(<DashboardPage />);
    expect(screen.getAllByText('Sin datos todavía.').length).toBeGreaterThanOrEqual(1);
  });

  it('cuenta los dispositivos online del store', () => {
    useInventoryStore.setState({
      devices: {
        d1: device({ id: 'd1', online: true }),
        d2: device({ id: 'd2', online: false }),
      },
    });
    render(<DashboardPage />);
    // StatCard "Dispositivos" → total 2; "Online" → 1.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1 offline')).toBeInTheDocument();
  });
});
