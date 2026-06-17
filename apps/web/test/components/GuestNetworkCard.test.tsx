import type { GuestNetwork } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { GuestNetworkCard } from '@/components/wifi/GuestNetworkCard';

const GUEST: GuestNetwork = {
  ssid: 'KrakenOS-Invitados',
  enabled: false,
  clientIsolation: true,
  bandwidthLimitMbps: 50,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('GuestNetworkCard', () => {
  beforeEach(() => {
    apiMock.put.mockReset().mockResolvedValue(GUEST);
  });

  it('un viewer no puede guardar', () => {
    render(<GuestNetworkCard network={GUEST} isAdmin={false} onUpdated={() => {}} />);
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument();
  });

  it('envía el límite como número y guarda en /wifi/guest', async () => {
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<GuestNetworkCard network={GUEST} isAdmin onUpdated={onUpdated} />);

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith('/wifi/guest', expect.anything()));
    expect(apiMock.put.mock.calls[0][1]).toMatchObject({
      ssid: 'KrakenOS-Invitados',
      clientIsolation: true,
      bandwidthLimitMbps: 50,
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it('envía bandwidthLimitMbps null cuando el campo se vacía', async () => {
    const user = userEvent.setup();
    render(<GuestNetworkCard network={GUEST} isAdmin onUpdated={() => {}} />);

    await user.clear(screen.getByLabelText(/Límite de ancho de banda/));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
    expect(apiMock.put.mock.calls[0][1]).toMatchObject({ bandwidthLimitMbps: null });
  });
});
