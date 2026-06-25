import type { Device } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock del cliente API: capturamos las llamadas sin tocar la red.
const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { DeviceDetailSlideover } from '@/components/inventory/DeviceDetailSlideover';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'dev-1',
    mac: 'aa:bb:cc:dd:ee:01',
    ip: '192.168.1.10',
    hostname: 'macbook',
    label: null,
    notes: null,
    vendor: 'Apple',
    type: 'computer',
    isBlocked: false,
    online: true,
    vlanTag: null,
    sources: ['arp', 'mdns'],
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function asRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('DeviceDetailSlideover', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue([]); // GET /vlans
    apiMock.patch.mockReset().mockResolvedValue(device());
    apiMock.post.mockReset().mockResolvedValue(device({ isBlocked: true }));
    apiMock.put.mockReset().mockResolvedValue(undefined);
    apiMock.del.mockReset().mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
  });

  it('muestra los datos del dispositivo', () => {
    asRole('viewer');
    render(<DeviceDetailSlideover device={device()} onClose={() => {}} />);
    expect(screen.getByText('192.168.1.10')).toBeInTheDocument();
    expect(screen.getByText('aa:bb:cc:dd:ee:01')).toBeInTheDocument();
    expect(screen.getByText('arp, mdns')).toBeInTheDocument();
  });

  it('guarda los cambios: PATCH con el body normalizado y cierra', async () => {
    asRole('viewer');
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DeviceDetailSlideover device={device()} onClose={onClose} />);

    await user.type(screen.getByLabelText('Nombre'), 'Mi portátil');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    expect(apiMock.patch).toHaveBeenCalledWith('/inventory/devices/dev-1', {
      label: 'Mi portátil',
      type: 'computer',
      notes: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('un viewer no ve el botón de bloqueo', () => {
    asRole('viewer');
    render(<DeviceDetailSlideover device={device()} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /bloquear/i })).not.toBeInTheDocument();
  });

  it('un admin puede bloquear: llama a POST /block', async () => {
    asRole('admin');
    const user = userEvent.setup();
    render(<DeviceDetailSlideover device={device({ isBlocked: false })} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Bloquear acceso a la red' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/inventory/devices/dev-1/block'));
  });

  it('bloqueo optimista: si la petición rechaza, revierte y avisa (US-96)', async () => {
    asRole('admin');
    // POST /block en vuelo: observamos el estado optimista antes de resolver.
    let reject!: (err: unknown) => void;
    apiMock.post.mockReset().mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }),
    );
    render(
      <>
        <DeviceDetailSlideover device={device({ isBlocked: false })} onClose={() => {}} />
        <Toaster />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Bloquear acceso a la red' }));
    // Optimista: el subtítulo marca "bloqueado" YA, con la petición aún en vuelo.
    await waitFor(() => expect(screen.getByText(/bloqueado/)).toBeInTheDocument());
    expect(apiMock.post).toHaveBeenCalledWith('/inventory/devices/dev-1/block');

    // Falla → revierte (no miente) y avisa por toast.
    reject(new Error('boom'));
    await waitFor(() => expect(screen.queryByText(/bloqueado/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Bloquear acceso a la red' })).toBeInTheDocument();
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument();
  });

  it('renderiza el sparkline cuando hay datos de tráfico (US-46)', async () => {
    asRole('viewer');
    apiMock.get.mockImplementation((url: string) => {
      if (url.startsWith('/traffic/devices')) {
        return Promise.resolve([
          {
            mac: 'aa:bb:cc:dd:ee:01',
            ip: '192.168.1.10',
            label: null,
            rxTotal: 100,
            txTotal: 50,
            samples: [
              { timestamp: '2026-01-01T00:00:00.000Z', rxBytesPerSec: 10, txBytesPerSec: 5 },
              { timestamp: '2026-01-01T00:01:00.000Z', rxBytesPerSec: 20, txBytesPerSec: 8 },
            ],
          },
        ]);
      }
      return Promise.resolve([]); // GET /vlans
    });

    render(<DeviceDetailSlideover device={device()} onClose={() => {}} />);

    // Cada Sparkline es un <svg role="img" aria-label="Tendencia">: rx y tx → 2.
    await waitFor(() =>
      expect(screen.getAllByRole('img', { name: 'Tendencia' })).toHaveLength(2),
    );
  });

  it('un admin asigna una VLAN: PUT con el tag', async () => {
    asRole('admin');
    apiMock.get.mockResolvedValue([
      { id: 'v1', tag: 30, name: 'IoT', subnet: null, isolated: true, createdAt: '', deviceCount: 0 },
    ]);
    const user = userEvent.setup();
    render(<DeviceDetailSlideover device={device()} onClose={() => {}} />);

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/vlans'));
    await user.selectOptions(screen.getByLabelText('VLAN'), '30');
    await waitFor(() =>
      expect(apiMock.put).toHaveBeenCalledWith('/inventory/devices/dev-1/vlan', { tag: 30 }),
    );
  });
});
