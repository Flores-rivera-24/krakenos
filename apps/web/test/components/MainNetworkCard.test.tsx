import type { WifiNetwork } from '@krakenos/types';
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

import { MainNetworkCard } from '@/components/wifi/MainNetworkCard';
import { ApiRequestError } from '@/lib/api';
import { changeLocale, setLocale } from '@/lib/i18n';

const NETWORK: WifiNetwork = {
  ssid: 'KrakenOS',
  enabled: true,
  band: '5GHz',
  security: 'wpa2/wpa3',
  hidden: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('MainNetworkCard', () => {
  beforeEach(() => {
    apiMock.put.mockReset().mockResolvedValue(NETWORK);
  });

  afterEach(() => setLocale('es', { persist: false }));

  it('un rechazo sin mensaje se pinta con el texto base, no vacío', async () => {
    apiMock.put.mockRejectedValue(new ApiRequestError(409, { code: 'X_DESCONOCIDO', message: '' }));
    render(<MainNetworkCard network={NETWORK} isAdmin onUpdated={() => {}} />);
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
    render(<MainNetworkCard network={NETWORK} isAdmin onUpdated={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Check the details and try again.'),
    );
  });

  it('un viewer ve los campos deshabilitados y sin botón de guardar', () => {
    render(<MainNetworkCard network={NETWORK} isAdmin={false} onUpdated={() => {}} />);
    expect(screen.getByLabelText('SSID')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument();
  });

  it('un admin guarda sin contraseña si no la cambia', async () => {
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<MainNetworkCard network={NETWORK} isAdmin onUpdated={onUpdated} />);

    await user.clear(screen.getByLabelText('SSID'));
    await user.type(screen.getByLabelText('SSID'), 'NuevaRed');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
    const [path, body] = apiMock.put.mock.calls[0]!;
    expect(path).toBe('/wifi');
    expect(body).toMatchObject({ ssid: 'NuevaRed', band: '5GHz', security: 'wpa2/wpa3' });
    expect(body).not.toHaveProperty('password');
    expect(onUpdated).toHaveBeenCalled();
    expect(screen.getByText('Cambios guardados')).toBeInTheDocument();
  });

  it('incluye la contraseña en el body cuando se escribe', async () => {
    const user = userEvent.setup();
    render(<MainNetworkCard network={NETWORK} isAdmin onUpdated={() => {}} />);

    await user.type(screen.getByLabelText('Contraseña'), 'claveseguraX');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
    expect(apiMock.put.mock.calls[0]![1]).toMatchObject({ password: 'claveseguraX' });
  });
});
