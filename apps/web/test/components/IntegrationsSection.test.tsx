import type { IotDevice } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), post: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { IntegrationsSection } from '@/components/settings/IntegrationsSection';

function iot(over: Partial<IotDevice>): IotDevice {
  return {
    id: 'x',
    name: 'Luz',
    kind: 'light',
    room: null,
    reachable: true,
    on: true,
    brightness: 80,
    color: null,
    readings: [],
    ...over,
  };
}

const DEVICES: IotDevice[] = [
  iot({ id: 'hue:1', reachable: true }),
  iot({ id: 'govee:1', reachable: false }),
  iot({ id: 'tuya:abc', reachable: true }),
];

describe('IntegrationsSection', () => {
  beforeEach(() => {
    apiMock.get
      .mockReset()
      .mockImplementation((path: string) =>
        path === '/iot/devices' ? Promise.resolve(DEVICES) : Promise.resolve([]),
      );
    apiMock.post.mockReset().mockResolvedValue({ ok: true, latencyMs: 2 });
  });

  it('renderiza las cards de Hue/Govee/Tuya con datos de /iot/devices', async () => {
    render(
      <MemoryRouter>
        <IntegrationsSection isAdmin />
      </MemoryRouter>,
    );
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/iot/devices'));
    expect(screen.getByText('Philips Hue')).toBeInTheDocument();
    expect(screen.getByText('Govee')).toBeInTheDocument();
    expect(screen.getByText('Tuya')).toBeInTheDocument();
    // Hue y Tuya: 1/1 en línea (Govee 0/1).
    await waitFor(() =>
      expect(screen.getAllByText('1/1 en línea').length).toBeGreaterThanOrEqual(1),
    );
    expect(screen.getByText('0/1 en línea')).toBeInTheDocument();
  });

  it('"Gestionar focos" despliega el gestor Tuya (admin)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <IntegrationsSection isAdmin />
      </MemoryRouter>,
    );
    await screen.findByText('Tuya');
    await user.click(screen.getByRole('button', { name: 'Gestionar focos' }));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/iot/tuya/devices'));
    expect(screen.getByText('Focos Tuya')).toBeInTheDocument();
  });

  it('"Cómo conectar" es un enlace a /connect, sin diálogo de rutas de ficheros', async () => {
    render(
      <MemoryRouter>
        <IntegrationsSection isAdmin />
      </MemoryRouter>,
    );
    const enlace = screen.getByRole('link', { name: 'Cómo conectar' });
    expect(enlace).toHaveAttribute('href', '/connect');
    expect(screen.queryByRole('button', { name: /Añadir integración/ })).toBeNull();
    expect(screen.queryByText('docs/tuya-setup.md')).toBeNull();
  });

  it('si falla la lectura no dice "No detectada": dice que no se pudo comprobar y reintenta', async () => {
    const user = userEvent.setup();
    let falla = true;
    apiMock.get.mockImplementation((path: string) =>
      path === '/iot/devices'
        ? falla
          ? Promise.reject(new Error('caído'))
          : Promise.resolve(DEVICES)
        : Promise.resolve([]),
    );
    render(
      <MemoryRouter>
        <IntegrationsSection isAdmin />
      </MemoryRouter>,
    );
    expect((await screen.findAllByText(/No se pudo comprobar/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('No detectada')).toBeNull();
    falla = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.getAllByText('1/1 en línea').length).toBeGreaterThan(0));
    expect(screen.queryAllByText(/No se pudo comprobar/)).toHaveLength(0);
  });
});
