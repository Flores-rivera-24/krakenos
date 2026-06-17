import type { CreatePeerResult, VpnPeer, VpnStatus } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { VpnPage } from '@/pages/VpnPage';

const STATUS: VpnStatus = {
  enabled: true,
  publicKey: 'serverpubkey',
  endpoint: 'vpn.test:51820',
  listenPort: 51820,
  peerCount: 0,
};

const PEER: VpnPeer = {
  id: 'p1',
  name: 'Móvil',
  publicKey: 'abcdef0123456789xyz',
  allowedIps: '10.8.0.2/32',
  lastHandshake: null,
  createdAt: '2026-06-17T00:00:00.000Z',
};

describe('VpnPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) =>
      Promise.resolve(path === '/vpn/status' ? STATUS : []),
    );
    apiMock.post.mockReset();
    apiMock.del.mockReset();
  });

  it('carga estado y muestra el endpoint y la tabla vacía', async () => {
    render(<VpnPage />);
    await waitFor(() => expect(screen.getByText('vpn.test:51820')).toBeInTheDocument());
    expect(screen.getByText(/Sin dispositivos/)).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/vpn/status');
    expect(apiMock.get).toHaveBeenCalledWith('/vpn/peers');
  });

  it('al crear un peer muestra el QR y el aviso de un solo uso', async () => {
    const result: CreatePeerResult = {
      peer: PEER,
      config: { config: '[Interface]\nPrivateKey = x\n', qr: 'data:image/png;base64,AAAA' },
    };
    apiMock.post.mockResolvedValue(result);

    render(<VpnPage />);
    await screen.findByText('vpn.test:51820');

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Móvil' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear peer/ }));

    expect(await screen.findByAltText('QR de configuración WireGuard')).toBeInTheDocument();
    expect(screen.getByText(/solo se muestra una vez/)).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/vpn/peers', { name: 'Móvil' });
  });

  it('muestra error si la carga falla', async () => {
    apiMock.get.mockRejectedValue(new Error('boom'));
    render(<VpnPage />);
    expect(await screen.findByText(/No se pudo cargar la VPN/)).toBeInTheDocument();
  });
});
