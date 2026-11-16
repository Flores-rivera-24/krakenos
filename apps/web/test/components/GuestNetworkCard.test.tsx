import type { GuestNetwork } from '@krakenos/types';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      readonly status: number,
      readonly body: { code: string; message: string },
    ) {
      super(body.message);
    }
  },
}));

import { GuestNetworkCard } from '@/components/wifi/GuestNetworkCard';
import { ApiRequestError } from '@/lib/api';
import { changeLocale, setLocale } from '@/lib/i18n';

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

  afterEach(() => setLocale('es', { persist: false }));

  it('un rechazo sin mensaje se pinta con el texto base, no vacío', async () => {
    apiMock.put.mockRejectedValue(new ApiRequestError(409, { code: 'X_DESCONOCIDO', message: '' }));
    render(<GuestNetworkCard network={GUEST} isAdmin onUpdated={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar (error 409).');
  });

  it('en inglés el error del servidor se traduce por su código', async () => {
    apiMock.put.mockRejectedValue(
      new ApiRequestError(400, { code: 'VALIDATION', message: 'Revisa los datos' }),
    );
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    render(<GuestNetworkCard network={GUEST} isAdmin onUpdated={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Check the details and try again.'),
    );
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
    expect(apiMock.put.mock.calls[0]![1]).toMatchObject({
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
    expect(apiMock.put.mock.calls[0]![1]).toMatchObject({ bandwidthLimitMbps: null });
  });
});
