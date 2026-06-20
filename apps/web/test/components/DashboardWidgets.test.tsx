import type { Device } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));
const fakeSocket = vi.hoisted(() => ({ connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { AlertsWidget } from '@/components/dashboard/widgets/AlertsWidget';
import { DeviceCountWidget } from '@/components/dashboard/widgets/DeviceCountWidget';
import { IotStatusWidget } from '@/components/dashboard/widgets/IotStatusWidget';
import { NetworkTopologyWidget } from '@/components/dashboard/widgets/NetworkTopologyWidget';
import { SystemWidget } from '@/components/dashboard/widgets/SystemWidget';
import { TrafficWidget } from '@/components/dashboard/widgets/TrafficWidget';
import { WifiStatusWidget } from '@/components/dashboard/widgets/WifiStatusWidget';
import { useInventoryStore } from '@/store/inventory.store';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'd1', mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.1.10', hostname: 'macbook',
    label: null, notes: null, vendor: 'Apple', type: 'computer', isBlocked: false,
    online: true, vlanTag: null, sources: ['arp'], firstSeen: '', lastSeen: '', ...over,
  };
}

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('Dashboard widgets', () => {
  const STATS = {
    uptimeSeconds: 3600,
    cpu: { cores: 4, loadPercent: 20 },
    memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 4 * 1024 ** 3, usedPercent: 50 },
    timestamp: '',
  };

  beforeEach(() => {
    apiMock.get
      .mockReset()
      .mockImplementation((path: string) =>
        path === '/system/stats' ? Promise.resolve(STATS) : Promise.resolve([]),
      );
    useInventoryStore.setState({ devices: {}, connected: true, recentEvents: [] });
  });

  it('DeviceCountWidget rinde con el store vacío', () => {
    wrap(<DeviceCountWidget />);
    expect(screen.getByText('Dispositivos')).toBeInTheDocument();
  });

  it('SystemWidget muestra el estado de carga sin datos', () => {
    wrap(<SystemWidget />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('IotStatusWidget rinde su título', () => {
    wrap(<IotStatusWidget />);
    expect(screen.getByText('IoT')).toBeInTheDocument();
  });

  it('WifiStatusWidget rinde su título', () => {
    wrap(<WifiStatusWidget />);
    expect(screen.getByText('WiFi')).toBeInTheDocument();
  });

  it('AlertsWidget rinde su título', () => {
    wrap(<AlertsWidget />);
    expect(screen.getByText('Alertas recientes')).toBeInTheDocument();
  });

  it('TrafficWidget espera muestras cuando no hay datos', () => {
    wrap(<TrafficWidget />);
    expect(screen.getByText('Esperando muestras…')).toBeInTheDocument();
  });

  it('NetworkTopologyWidget muestra el estado vacío sin dispositivos', () => {
    wrap(<NetworkTopologyWidget />);
    expect(screen.getByText('Sin dispositivos en la red.')).toBeInTheDocument();
  });

  it('NetworkTopologyWidget renderiza nodos clicables cuando hay dispositivos', () => {
    useInventoryStore.setState({
      devices: {
        r: device({ id: 'r', type: 'router', hostname: 'gateway' }),
        d1: device({ id: 'd1', hostname: 'macbook' }),
        d2: device({ id: 'd2', hostname: 'phone' }),
      },
    });
    wrap(<NetworkTopologyWidget />);
    expect(screen.getByLabelText('Diagrama de la red')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'macbook' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'phone' })).toBeInTheDocument();
  });
});
