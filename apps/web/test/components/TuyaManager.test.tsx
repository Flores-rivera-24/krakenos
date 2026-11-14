import type { TuyaDeviceView } from '@krakenos/types';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  };
});
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

import { TuyaManager } from '@/components/settings/TuyaManager';
import { ApiRequestError } from '@/lib/api';
import { changeLocale, setLocale } from '@/lib/i18n';

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

  afterEach(() => setLocale('es', { persist: false }));

  it('un rechazo sin mensaje se pinta con el texto base, no vacío', async () => {
    const user = userEvent.setup();
    apiMock.del.mockRejectedValue(new ApiRequestError(409, { code: 'X_DESCONOCIDO', message: '' }));
    render(<TuyaManager reachable={new Set()} />);
    await screen.findByText('Salón');
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo completar la operación (error 409).',
    );
  });

  it('en inglés el error del servidor se traduce por su código', async () => {
    const user = userEvent.setup();
    apiMock.del.mockRejectedValue(
      new ApiRequestError(400, { code: 'VALIDATION', message: 'Revisa los datos' }),
    );
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    render(<TuyaManager reachable={new Set()} />);
    await screen.findByText('Salón');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Check the details and try again.'),
    );
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
        expect.objectContaining({
          deviceId: 'newid000000',
          localKey: 'secretkey',
          ip: '192.168.1.51',
          name: 'Cocina',
        }),
      ),
    );
  });

  it('con un foco en edición y el alta abierta, cada etiqueta apunta a su propio campo', async () => {
    const user = userEvent.setup();
    render(<TuyaManager reachable={new Set()} />);
    await screen.findByText('Salón');
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.click(screen.getByRole('button', { name: 'Añadir foco' }));
    const ips = screen.getAllByLabelText('IP');
    expect(ips).toHaveLength(2);
    expect(ips[0]).not.toBe(ips[1]);
    expect(ips[0]?.tagName).toBe('INPUT');
    expect(ips[1]?.tagName).toBe('INPUT');
  });

  it('un clic en eliminar no borra; Confirmar sí', async () => {
    const user = userEvent.setup();
    render(<TuyaManager reachable={new Set()} />);
    await screen.findByText('Salón');

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(apiMock.del).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(apiMock.del).toHaveBeenCalledWith('/iot/tuya/devices/abcdef1234567890'),
    );
  });

  it('si falla la lectura no dice "Sin focos Tuya registrados": dice el fallo y reintenta', async () => {
    const user = userEvent.setup();
    apiMock.get.mockReset().mockRejectedValue(new Error('caído'));
    render(<TuyaManager reachable={new Set()} />);
    expect(await screen.findByText(/No se pudieron cargar los focos Tuya/)).toBeInTheDocument();
    expect(screen.queryByText('Sin focos Tuya registrados.')).toBeNull();
    apiMock.get.mockResolvedValue(FOCOS);
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Salón')).toBeInTheDocument();
    expect(screen.queryByText(/No se pudieron cargar los focos Tuya/)).toBeNull();
  });

  it('al reintentar tras un fallo muestra que está cargando, no una tabla en blanco', async () => {
    const user = userEvent.setup();
    apiMock.get.mockReset().mockRejectedValue(new Error('caído'));
    render(<TuyaManager reachable={new Set()} />);
    await screen.findByText(/No se pudieron cargar los focos Tuya/);
    let resolver: (v: TuyaDeviceView[]) => void = () => {};
    apiMock.get.mockReturnValue(new Promise<TuyaDeviceView[]>((r) => (resolver = r)));
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Cargando');
    expect(screen.queryByText('Sin focos Tuya registrados.')).toBeNull();
    await act(async () => resolver(FOCOS));
    expect(await screen.findByText('Salón')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('en la primera carga también muestra que está cargando', async () => {
    let resolver: (v: TuyaDeviceView[]) => void = () => {};
    apiMock.get.mockReset().mockReturnValue(new Promise<TuyaDeviceView[]>((r) => (resolver = r)));
    render(<TuyaManager reachable={new Set()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando');
    await act(async () => resolver(FOCOS));
    expect(await screen.findByText('Salón')).toBeInTheDocument();
  });

  it('en edición el selector de versión está deshabilitado (el PATCH no lo manda)', async () => {
    const user = userEvent.setup();
    render(<TuyaManager reachable={new Set()} />);
    await screen.findByText('Salón');
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByLabelText('Versión')).toBeDisabled();
  });

  it('al añadir, el selector de versión sigue habilitado', async () => {
    const user = userEvent.setup();
    render(<TuyaManager reachable={new Set()} />);
    await screen.findByText('Salón');
    await user.click(screen.getByRole('button', { name: 'Añadir foco' }));
    expect(screen.getByLabelText('Versión')).toBeEnabled();
  });

  it('si el reintento tras borrar falla, conserva los focos y los marca como viejos', async () => {
    const user = userEvent.setup();
    render(<TuyaManager reachable={new Set()} />);
    await screen.findByText('Salón');
    apiMock.get.mockRejectedValue(new Error('caído'));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(apiMock.del).toHaveBeenCalled());
    expect(await screen.findByText('Datos obsoletos')).toBeInTheDocument();
    expect(screen.getByText('Salón')).toBeInTheDocument();
    expect(screen.queryByText('Sin focos Tuya registrados.')).toBeNull();
  });
});
