import type { CreatePeerResult, VpnPeer, VpnStatus } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), post: vi.fn(), del: vi.fn() };
});
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
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/vpn/status') return Promise.resolve(STATUS);
      if (path === '/vpn/tailscale')
        return Promise.resolve({
          state: 'not-installed',
          tailscaleIp: null,
          magicDnsName: null,
          version: null,
        });
      return Promise.resolve([]);
    });
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
    fireEvent.click(screen.getByRole('button', { name: /Añadir dispositivo/ }));

    expect(await screen.findByAltText('QR de configuración WireGuard')).toBeInTheDocument();
    expect(screen.getByText(/solo se muestra una vez/)).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/vpn/peers', { name: 'Móvil' });
  });

  it('muestra un banner role="alert" de conexión si la carga falla (red)', async () => {
    apiMock.get.mockRejectedValue(new Error('boom')); // sin respuesta = fallo de red
    render(<VpnPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar con el servidor/);
  });
});
