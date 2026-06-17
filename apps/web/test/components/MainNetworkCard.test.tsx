import type { WifiNetwork } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { MainNetworkCard } from '@/components/wifi/MainNetworkCard';

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
    const [path, body] = apiMock.put.mock.calls[0];
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
    expect(apiMock.put.mock.calls[0][1]).toMatchObject({ password: 'claveseguraX' });
  });
});
