import type { DeviceTrafficStats, TrafficSample, TrafficStats } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

const socketMock = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/socket', () => ({ getSocket: () => socketMock }));

import { TrafficPage } from '@/pages/TrafficPage';

const SAMPLE: TrafficSample = {
  timestamp: '2026-06-17T00:00:00.000Z',
  rxBytesPerSec: 1_250_000, // 10 Mbps
  txBytesPerSec: 125_000, // 1 Mbps
};

const EMPTY_STATS: TrafficStats = {
  range: 'day',
  buckets: [],
  totalRxBytes: 0,
  totalTxBytes: 0,
};

/** Mock que distingue `/traffic/stats` (objeto), `/traffic/devices` (array) y `/traffic/history` (array). */
function mockApi({
  history = [],
  stats = EMPTY_STATS,
  devices = [],
}: {
  history?: TrafficSample[];
  stats?: TrafficStats;
  devices?: DeviceTrafficStats[];
} = {}) {
  apiMock.get.mockImplementation((url: string) => {
    if (url.startsWith('/traffic/stats')) return Promise.resolve(stats);
    if (url.startsWith('/traffic/devices')) return Promise.resolve(devices);
    return Promise.resolve(history);
  });
}

describe('TrafficPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    socketMock.on.mockReset();
    socketMock.off.mockReset();
  });

  it('muestra el estado de espera sin muestras y se suscribe al socket', async () => {
    mockApi();
    render(<TrafficPage />);

    expect(await screen.findByText('Monitor de tráfico')).toBeInTheDocument();
    expect(screen.getByText(/Esperando muestras/)).toBeInTheDocument();
    expect(socketMock.on).toHaveBeenCalledWith('traffic:sample', expect.any(Function));
    expect(socketMock.on).toHaveBeenCalledWith('traffic:history', expect.any(Function));
  });

  it('muestra las tasas actuales a partir del histórico', async () => {
    mockApi({ history: [SAMPLE] });
    render(<TrafficPage />);

    await waitFor(() => expect(screen.getByText('10.0 Mbps')).toBeInTheDocument());
    expect(screen.getByText('1.0 Mbps')).toBeInTheDocument();
  });

  it('muestra el total de datos del histórico y pide el rango por defecto', async () => {
    const stats: TrafficStats = {
      range: 'day',
      buckets: [{ timestamp: '2026-06-17T00:00:00.000Z', rxBytesPerSec: 1_000_000, txBytesPerSec: 500_000 }],
      totalRxBytes: 2 * 1024 ** 3, // 2.0 GB
      totalTxBytes: 512 * 1024 ** 2, // 512 MB
    };
    mockApi({ stats });
    render(<TrafficPage />);

    await waitFor(() => expect(screen.getByText('2.0 GB')).toBeInTheDocument());
    expect(screen.getByText('512 MB')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/traffic/stats?range=day');
  });

  it('muestra la tabla "Por dispositivo" cuando el driver reporta datos (US-46)', async () => {
    mockApi({
      devices: [
        {
          mac: 'aa:bb:cc:00:00:09',
          ip: '192.168.1.9',
          label: 'TV',
          rxTotal: 2 * 1024 ** 2,
          txTotal: 1024 ** 2,
          samples: [],
        },
      ],
    });
    render(<TrafficPage />);

    expect(await screen.findByText('Por dispositivo')).toBeInTheDocument();
    expect(screen.getByText('TV')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.9')).toBeInTheDocument();
  });

  it('al cambiar de rango vuelve a pedir las estadísticas', async () => {
    mockApi();
    render(<TrafficPage />);

    await screen.findByText('Histórico');
    await userEvent.click(screen.getByRole('button', { name: '7d' }));

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/traffic/stats?range=week'));
  });
});
