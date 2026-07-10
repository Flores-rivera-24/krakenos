import type { WellbeingUsage } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { WellbeingCard } from '@/components/wellbeing/WellbeingCard';

const usage: WellbeingUsage = {
  range: 'week',
  people: [
    { userId: 'u1', name: 'Ana', rxBytes: 2_000_000, txBytes: 500_000, totalBytes: 2_500_000, deviceCount: 3, buckets: [] },
    { userId: null, name: 'Sin asignar', rxBytes: 100, txBytes: 0, totalBytes: 100, deviceCount: 1, buckets: [] },
  ],
};

describe('WellbeingCard (US-184)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(usage);
  });

  it('muestra el uso por persona con nombre y total', async () => {
    render(<WellbeingCard />);
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    // El grupo sin dueño se localiza a partir de userId === null.
    expect(screen.getByText('Sin asignar')).toBeInTheDocument();
  });

  it('estado vacío cuando no hay datos', async () => {
    apiMock.get.mockResolvedValue({ range: 'week', people: [] });
    render(<WellbeingCard />);
    expect(await screen.findByText(/Sin datos de uso todavía/)).toBeInTheDocument();
  });

  it('no rompe ante una respuesta malformada', async () => {
    apiMock.get.mockResolvedValue({});
    render(<WellbeingCard />);
    expect(await screen.findByText(/Sin datos de uso todavía/)).toBeInTheDocument();
  });
});
