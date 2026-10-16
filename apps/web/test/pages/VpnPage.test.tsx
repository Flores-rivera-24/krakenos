import type {
  CreatePeerResult,
  GatewayCapability,
  VpnPeer,
  VpnStatusResponse,
} from '@krakenos/types';
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

const STATUS: VpnStatusResponse = {
  enabled: true,
  publicKey: 'serverpubkey',
  endpoint: 'vpn.test:51820',
  listenPort: 51820,
  peerCount: 0,
  capability: { status: 'supported' },
};

const PEER: VpnPeer = {
  id: 'p1',
  name: 'Móvil',
  publicKey: 'abcdef0123456789xyz',
  allowedIps: '10.8.0.2/32',
  lastHandshake: null,
  createdAt: '2026-06-17T00:00:00.000Z',
};

/** Mock por ruta: el estado con la capacidad dada, Tailscale ausente y los peers dados. */
function mockApi(capability: GatewayCapability = { status: 'supported' }, peers: VpnPeer[] = []) {
  apiMock.get.mockReset().mockImplementation((path: string) => {
    if (path === '/vpn/status') return Promise.resolve({ ...STATUS, capability });
    if (path === '/vpn/peers') return Promise.resolve(peers);
    if (path === '/vpn/tailscale')
      return Promise.resolve({
        state: 'not-installed',
        tailscaleIp: null,
        magicDnsName: null,
        version: null,
      });
    return Promise.resolve([]);
  });
}

describe('VpnPage', () => {
  beforeEach(() => {
    mockApi();
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

describe('VpnPage: capacidad de puerta de enlace de este equipo', () => {
  beforeEach(() => {
    apiMock.post.mockReset();
    apiMock.del.mockReset();
  });

  it('supported: sin aviso y con el formulario de alta', async () => {
    mockApi({ status: 'supported' });
    render(<VpnPage />);
    await screen.findByText('vpn.test:51820');
    expect(screen.getByRole('button', { name: /Añadir dispositivo/ })).toBeInTheDocument();
    expect(screen.queryByText('Este equipo no puede hacer de puerta de enlace')).toBeNull();
    expect(screen.queryByText('Falta instalar el helper de puerta de enlace')).toBeNull();
  });

  it('unsupported: avisa de que en Windows hay que usar la VPN del router, sin formulario, y Tailscale sigue', async () => {
    mockApi({ status: 'unsupported', reason: 'platform' }, [PEER]);
    render(<VpnPage />);
    await screen.findByText('vpn.test:51820');
    expect(screen.getByText('Este equipo no puede hacer de puerta de enlace')).toBeInTheDocument();
    expect(
      screen.getByText(/En Windows, KrakenOS no hace de puerta de enlace.*servidor WireGuard/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Añadir dispositivo/ })).toBeNull();
    expect(screen.queryByLabelText('Nombre')).toBeNull();
    // Eliminar sería un botón que siempre falla.
    expect(await screen.findByText('Móvil')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull();
    // La tarjeta de Tailscale no depende de la capacidad.
    expect(apiMock.get).toHaveBeenCalledWith('/vpn/tailscale');
  });

  it('unsupported y sin dispositivos: el vacío no manda a «crear el primero arriba»', async () => {
    mockApi({ status: 'unsupported', reason: 'platform' });
    render(<VpnPage />);
    expect(await screen.findByText('Sin dispositivos.')).toBeInTheDocument();
    expect(screen.queryByText(/Crea el primero arriba/)).toBeNull();
    expect(screen.queryByText(/pulsa «Añadir dispositivo»/)).toBeNull();
  });

  it('requires-setup: dice cómo instalar el helper y no ofrece alta', async () => {
    mockApi({ status: 'requires-setup', reason: 'helper-missing' });
    render(<VpnPage />);
    await screen.findByText('vpn.test:51820');
    expect(screen.getByText('Falta instalar el helper de puerta de enlace')).toBeInTheDocument();
    expect(screen.getByText(/install\.sh --with-helper/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Añadir dispositivo/ })).toBeNull();
  });
});
