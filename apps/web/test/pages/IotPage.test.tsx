import type { IotDevice } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

const socketMock = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/socket', () => ({ getSocket: () => socketMock }));

import { IotPage } from '@/pages/IotPage';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth.store';
import { useConnectionStore } from '@/store/connection.store';
import { useToastStore } from '@/store/toast.store';

const DEVICES: IotDevice[] = [
  {
    id: 'plug-tv',
    name: 'TV',
    kind: 'plug',
    room: 'Salón',
    reachable: true,
    on: true,
    brightness: null,
    color: null,
    reading: null,
  },
  {
    id: 'sensor-temp',
    name: 'Temperatura',
    kind: 'sensor',
    room: 'Salón',
    reachable: true,
    on: null,
    brightness: null,
    color: null,
    reading: { metric: 'temperatura', value: 21.5, unit: '°C' },
  },
  {
    id: 'light-hue',
    name: 'Foco Hue',
    kind: 'light',
    room: 'Salón',
    reachable: true,
    on: true,
    brightness: 80,
    color: { hex: '#ff8800', temperatureK: null },
    reading: null,
  },
];

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('IotPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(DEVICES);
    apiMock.patch.mockReset().mockResolvedValue(DEVICES[0]);
    socketMock.on.mockReset();
    socketMock.off.mockReset();
    useConnectionStore.setState({ status: 'connected' });
    useToastStore.setState({ toasts: [] });
  });

  it('lista dispositivos y muestra la lectura del sensor', async () => {
    setRole('admin');
    render(<IotPage />);
    await waitFor(() => expect(screen.getByText('TV')).toBeInTheDocument());
    expect(screen.getByText('Temperatura')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
  });

  it('un admin puede alternar un enchufe (PATCH)', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('TV');

    // TV es el primer dispositivo, así que su switch es el primero.
    fireEvent.click(screen.getAllByRole('switch')[0]!);
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/plug-tv', { on: false });
  });

  it('toggle optimista: si el PATCH rechaza, el switch revierte y avisa (US-96)', async () => {
    setRole('admin');
    // Petición controlada: la dejamos en vuelo para observar el estado optimista.
    let reject!: (err: unknown) => void;
    apiMock.patch.mockReset().mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }),
    );
    render(
      <>
        <IotPage />
        <Toaster />
      </>,
    );
    await screen.findByText('TV');

    const sw = screen.getAllByRole('switch')[0]!; // TV (plug), on: true
    expect(sw).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(sw);
    // Optimista: se mueve YA, sin esperar al servidor.
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/plug-tv', { on: false });

    // La petición falla → revierte (no miente) y muestra un toast de error.
    reject(new Error('network down'));
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument();
  });

  it('un admin puede cambiar el color de una luz con color (PATCH)', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('Foco Hue');

    const picker = screen.getByLabelText('Color') as HTMLInputElement;
    fireEvent.input(picker, { target: { value: '#00ff00' } });
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/light-hue', {
      color: { hex: '#00ff00' },
    });
  });

  it('un viewer ve el aviso de solo lectura', async () => {
    setRole('viewer');
    render(<IotPage />);
    expect(await screen.findByText(/Solo lectura/)).toBeInTheDocument();
  });

  it('muestra un banner role="alert" si la carga falla (US-93)', async () => {
    setRole('admin');
    apiMock.get.mockReset().mockRejectedValue(new Error('boom'));
    render(<IotPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar con el servidor/);
  });

  it('muestra el estado vacío honesto sin dispositivos (US-93)', async () => {
    setRole('admin');
    apiMock.get.mockReset().mockResolvedValue([]);
    render(<IotPage />);
    expect(await screen.findByText(/Aún no hay dispositivos IoT/)).toBeInTheDocument();
  });

  it('marca los datos como obsoletos cuando el stream está caído (US-94)', async () => {
    setRole('admin');
    useConnectionStore.setState({ status: 'offline' });
    render(<IotPage />);
    await screen.findByText('TV');
    expect(screen.getByText('Datos obsoletos')).toBeInTheDocument();
  });

  it('sin caída del stream no marca obsoleto (US-94)', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('TV');
    expect(screen.queryByText('Datos obsoletos')).not.toBeInTheDocument();
  });
});
