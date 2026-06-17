import type { SystemStats } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { SystemCard } from '@/components/dashboard/SystemCard';

const STATS: SystemStats = {
  uptimeSeconds: 90061,
  cpu: { cores: 8, loadPercent: 45 },
  memory: { totalBytes: 16 * 1024 ** 3, usedBytes: 8 * 1024 ** 3, usedPercent: 50 },
  timestamp: '2026-06-17T12:00:00.000Z',
};

describe('SystemCard', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
  });

  it('muestra "Cargando…" antes de recibir datos', () => {
    apiMock.get.mockReturnValue(new Promise(() => {})); // nunca resuelve
    render(<SystemCard />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('renderiza uptime, CPU y memoria al cargar', async () => {
    apiMock.get.mockResolvedValue(STATS);
    render(<SystemCard />);

    await waitFor(() => expect(screen.getByText('1d 1h 1m')).toBeInTheDocument());
    expect(screen.getByText('45% · 8 núcleos')).toBeInTheDocument();
    expect(screen.getByText('8.0 GB / 16.0 GB')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/system/stats');
  });
});
