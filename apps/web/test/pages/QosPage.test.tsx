import type { GatewayCapability, QosRule } from '@krakenos/types';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useEstadosStore } from '@/lib/integration-states';
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
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { QosPage } from '@/pages/QosPage';
import { useAuthStore } from '@/store/auth.store';

const RULE: QosRule = {
  id: 'q1',
  name: 'Limitar consola',
  priority: 'low',
  target: '10.0.0.50',
  downloadKbps: 20_000,
  uploadKbps: 5_000,
  enabled: true,
  createdAt: '2026-06-17T00:00:00.000Z',
};

/** Mock por ruta: `/qos/status` lleva la capacidad y el resto de GET devuelven las reglas. */
function mockApi(rules: QosRule[], capability: GatewayCapability = { status: 'supported' }) {
  apiMock.get
    .mockReset()
    .mockImplementation((path: string) =>
      path === '/qos/status' ? Promise.resolve({ capability }) : Promise.resolve(rules),
    );
}

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'Emilio', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', expiresIn: 900 },
  });
}

describe('QosPage', () => {
  beforeEach(() => {
    mockApi([RULE]);
    apiMock.post.mockReset().mockResolvedValue(RULE);
    apiMock.patch.mockReset().mockResolvedValue({ ...RULE, enabled: false });
    apiMock.del.mockReset().mockResolvedValue(undefined);
    setRole('admin');
  });

  it('muestra las reglas con prioridad y límite legible', async () => {
    render(<QosPage />);
    await waitFor(() => expect(screen.getByText('Limitar consola')).toBeInTheDocument());
    expect(screen.getByText('10.0.0.50')).toBeInTheDocument();
    expect(screen.getByText('20 Mbps')).toBeInTheDocument(); // 20000 kbps
    expect(apiMock.get).toHaveBeenCalledWith('/qos/rules');
  });

  it('crea una regla con el formulario (admin)', async () => {
    render(<QosPage />);
    await screen.findByText('Limitar consola');

    await userEvent.type(screen.getByLabelText('Nombre'), 'Prioridad trabajo');
    await userEvent.type(screen.getByLabelText('Objetivo'), '10.0.0.20');
    await userEvent.click(screen.getByRole('button', { name: /Añadir regla/ }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/qos/rules',
        expect.objectContaining({
          name: 'Prioridad trabajo',
          target: '10.0.0.20',
          priority: 'normal',
        }),
      ),
    );
  });

  it('alterna el estado de una regla con el switch', async () => {
    render(<QosPage />);
    await screen.findByText('Limitar consola');

    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/qos/rules/q1', { enabled: false }),
    );
  });

  it('un viewer no pide las lecturas de administrador', async () => {
    setRole('viewer');
    render(<QosPage />);
    const aviso = await screen.findByRole('note');
    expect(aviso).toHaveTextContent('Solo el administrador ve las reglas de QoS');
    expect(apiMock.get.mock.calls.filter(([p]) => String(p).startsWith('/qos'))).toHaveLength(0);
    expect(screen.queryByText(/Aún no hay reglas de QoS/)).toBeNull();
    expect(screen.queryByText('Nueva regla')).not.toBeInTheDocument();
  });

  it('si el rol llega después de montar, no queda pintado el error de la petición ya lanzada', async () => {
    useAuthStore.setState({ user: null });
    apiMock.get.mockReset().mockRejectedValue(new Error('403'));
    render(<QosPage />);
    expect(apiMock.get).toHaveBeenCalledWith('/qos/rules');
    act(() => setRole('viewer'));
    await screen.findByRole('note');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('un admin con la lectura caída ve el error y no el estado vacío ni el aviso de admin', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('boom'));
    render(<QosPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/Aún no hay reglas de QoS/)).toBeNull();
    expect(screen.queryByText('Solo el administrador ve las reglas de QoS')).toBeNull();
  });

  it('muestra un banner role="alert" si la carga falla (US-93)', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('boom'));
    render(<QosPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar con el servidor/);
  });

  it('muestra el estado vacío honesto sin reglas (US-93)', async () => {
    mockApi([]);
    render(<QosPage />);
    expect(await screen.findByText(/Aún no hay reglas de QoS/)).toBeInTheDocument();
  });
});

describe('QosPage: capacidad de puerta de enlace de este equipo', () => {
  beforeEach(() => {
    apiMock.post.mockReset();
    apiMock.patch.mockReset();
    apiMock.del.mockReset();
    setRole('admin');
  });

  it('supported: sin aviso y con el formulario de alta', async () => {
    mockApi([RULE], { status: 'supported' });
    render(<QosPage />);
    await screen.findByText('Limitar consola');
    expect(screen.getByRole('button', { name: /Añadir regla/ })).toBeInTheDocument();
    expect(screen.queryByText('Este equipo no puede hacer de puerta de enlace')).toBeNull();
    expect(screen.queryByText('Falta instalar el helper de puerta de enlace')).toBeNull();
    expect(apiMock.get).toHaveBeenCalledWith('/qos/status');
  });

  it('unsupported: avisa de que en Windows hay que usar el QoS del router y no ofrece alta', async () => {
    mockApi([RULE], { status: 'unsupported', reason: 'platform' });
    render(<QosPage />);
    await screen.findByText('Limitar consola');
    expect(screen.getByText('Este equipo no puede hacer de puerta de enlace')).toBeInTheDocument();
    expect(
      screen.getByText(/En Windows, KrakenOS no hace de puerta de enlace.*QoS de tu router/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Añadir regla/ })).toBeNull();
    expect(screen.queryByLabelText('Nombre')).toBeNull();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Eliminar regla/ })).toBeNull();
  });

  it('requires-setup: dice cómo instalar el helper y no ofrece alta', async () => {
    mockApi([RULE], { status: 'requires-setup', reason: 'helper-missing' });
    render(<QosPage />);
    await screen.findByText('Limitar consola');
    expect(screen.getByText('Falta instalar el helper de puerta de enlace')).toBeInTheDocument();
    expect(screen.getByText(/install\.sh --with-helper/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Añadir regla/ })).toBeNull();
  });

  it('sin reglas y sin capacidad de crearlas, el vacío no manda a «crear una arriba»', async () => {
    mockApi([], { status: 'unsupported', reason: 'platform' });
    render(<QosPage />);
    expect(await screen.findByText(/Aún no hay reglas de QoS/)).toBeInTheDocument();
    expect(screen.queryByText(/Crea una regla arriba/)).toBeNull();
  });

  describe('estado del dominio (instalación nueva)', () => {
    const conRouter = () =>
      render(
        <MemoryRouter>
          <QosPage />
        </MemoryRouter>,
      );
    afterEach(() => useEstadosStore.setState({ estados: null }));

    it('not-configured: el MISMO aviso «Sin configurar» de las demás páginas, sin alta', async () => {
      mockApi([], { status: 'not-configured', reason: 'not-configured' });
      conRouter();
      expect(await screen.findByText('Sin configurar')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Ir a Conectar' })).toHaveAttribute(
        'href',
        '/connect',
      );
      // Un solo aviso, y ninguno de los de capacidad del equipo.
      expect(screen.getAllByRole('note')).toHaveLength(1);
      expect(screen.queryByText('Falta instalar el helper de puerta de enlace')).toBeNull();
      // Y sin el vacío que culpa al usuario («aún no hay reglas»): el aviso lo dice todo.
      expect(screen.queryByText(/Aún no hay reglas/)).toBeNull();
    });

    it('supported + demo: un aviso «Datos de demostración» y la página entera', async () => {
      mockApi([]);
      useEstadosStore.setState({ estados: { qos: 'demo' } });
      conRouter();
      expect(await screen.findByText('Datos de demostración')).toBeInTheDocument();
      expect(screen.getAllByRole('note')).toHaveLength(1);
    });

    it('nunca dos avisos a la vez: si el equipo no puede, solo el suyo (no el de demostración)', async () => {
      mockApi([], { status: 'unsupported', reason: 'platform' });
      useEstadosStore.setState({ estados: { qos: 'demo' } });
      conRouter();
      expect(
        await screen.findByText('Este equipo no puede hacer de puerta de enlace'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Datos de demostración')).toBeNull();
      expect(screen.getAllByRole('note')).toHaveLength(1);
    });
  });
});
