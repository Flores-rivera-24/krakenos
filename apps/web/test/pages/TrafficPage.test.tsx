import type { TrafficSample } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('TrafficPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    socketMock.on.mockReset();
    socketMock.off.mockReset();
  });

  it('muestra el estado de espera sin muestras y se suscribe al socket', async () => {
    apiMock.get.mockResolvedValue([]);
    render(<TrafficPage />);

    expect(await screen.findByText('Monitor de tráfico')).toBeInTheDocument();
    expect(screen.getByText(/Esperando muestras/)).toBeInTheDocument();
    expect(socketMock.on).toHaveBeenCalledWith('traffic:sample', expect.any(Function));
    expect(socketMock.on).toHaveBeenCalledWith('traffic:history', expect.any(Function));
  });

  it('muestra las tasas actuales a partir del histórico', async () => {
    apiMock.get.mockResolvedValue([SAMPLE]);
    render(<TrafficPage />);

    await waitFor(() => expect(screen.getByText('10.0 Mbps')).toBeInTheDocument());
    expect(screen.getByText('1.0 Mbps')).toBeInTheDocument();
  });
});
