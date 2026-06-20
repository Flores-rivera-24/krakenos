import type { TuyaDeviceView } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { TuyaManager } from '@/components/settings/TuyaManager';

const FOCOS: TuyaDeviceView[] = [
  { deviceId: 'abcdef1234567890', ip: '192.168.1.50', name: 'Salón', version: '3.3' },
];

describe('TuyaManager', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(FOCOS);
    apiMock.post.mockReset().mockResolvedValue(undefined);
    apiMock.patch.mockReset().mockResolvedValue(undefined);
    apiMock.del.mockReset().mockResolvedValue(undefined);
  });

  it('lista los focos registrados (sin localKey en la respuesta)', async () => {
    render(<TuyaManager reachable={new Set()} />);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/iot/tuya/devices'));
    expect(await screen.findByText('Salón')).toBeInTheDocument();
    // El device id se trunca y la respuesta GET no trae localKey.
    expect(screen.getByText(/abcdef12…/)).toBeInTheDocument();
    expect(FOCOS[0]).not.toHaveProperty('localKey');
  });

  it('el formulario de añadir foco usa localKey type=password y hace POST', async () => {
    const user = userEvent.setup();
    render(<TuyaManager reachable={new Set()} />);
    await screen.findByText('Salón');

    await user.click(screen.getByRole('button', { name: 'Añadir foco' }));
    await user.type(screen.getByLabelText('Nombre'), 'Cocina');
    await user.type(screen.getByLabelText('IP'), '192.168.1.51');
    await user.type(screen.getByLabelText('Device ID'), 'newid000000');
    const localKey = screen.getByLabelText('Local Key');
    expect(localKey).toHaveAttribute('type', 'password');
    await user.type(localKey, 'secretkey');

    await user.click(screen.getByRole('button', { name: 'Añadir foco' }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/iot/tuya/devices',
        expect.objectContaining({ deviceId: 'newid000000', localKey: 'secretkey', ip: '192.168.1.51', name: 'Cocina' }),
      ),
    );
  });

  it('eliminar pide confirmación inline antes del DELETE', async () => {
    const user = userEvent.setup();
    render(<TuyaManager reachable={new Set()} />);
    await screen.findByText('Salón');

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(screen.getByText('¿Eliminar?')).toBeInTheDocument();
    expect(apiMock.del).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sí' }));
    await waitFor(() =>
      expect(apiMock.del).toHaveBeenCalledWith('/iot/tuya/devices/abcdef1234567890'),
    );
  });
});
