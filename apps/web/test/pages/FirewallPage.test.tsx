import type { FirewallRule, GatewayCapability } from '@krakenos/types';
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
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { changeLocale, setLocale } from '@/lib/i18n';
import { FirewallPage } from '@/pages/FirewallPage';
import { useAuthStore } from '@/store/auth.store';

const RULE: FirewallRule = {
  id: 'r1',
  name: 'Bloquear IoT',
  action: 'deny',
  protocol: 'any',
  source: '10.0.30.0/24',
  destination: null,
  port: null,
  enabled: true,
  priority: 0,
  createdAt: '2026-06-17T00:00:00.000Z',
};

/** Mock por ruta: `/firewall/status` lleva la capacidad y el resto de GET devuelven las reglas. */
function mockApi(rules: FirewallRule[], capability: GatewayCapability = { status: 'supported' }) {
  apiMock.get
    .mockReset()
    .mockImplementation((path: string) =>
      path === '/firewall/status' ? Promise.resolve({ capability }) : Promise.resolve(rules),
    );
}

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'Emilio', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', expiresIn: 900 },
  });
}

describe('FirewallPage', () => {
  beforeEach(() => {
    mockApi([RULE]);
    apiMock.post.mockReset().mockResolvedValue(RULE);
    apiMock.patch.mockReset().mockResolvedValue({ ...RULE, enabled: false });
    apiMock.del.mockReset().mockResolvedValue(undefined);
    setRole('admin');
  });

  it('carga y muestra las reglas existentes', async () => {
    render(<FirewallPage />);
    await waitFor(() => expect(screen.getByText('Bloquear IoT')).toBeInTheDocument());
    expect(screen.getByText('10.0.30.0/24')).toBeInTheDocument();
    // La acción/protocolo se muestran con etiqueta en español, no el valor crudo de la API.
    expect(screen.getByRole('cell', { name: 'Bloquear' })).toBeInTheDocument();
    expect(screen.queryByText('deny')).not.toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/firewall/rules');
  });

  it('crea una regla con el formulario (admin)', async () => {
    render(<FirewallPage />);
    await screen.findByText('Bloquear IoT');

    await userEvent.type(screen.getByLabelText('Nombre'), 'Nueva regla');
    await userEvent.click(screen.getByRole('button', { name: /Añadir regla/ }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/firewall/rules',
        expect.objectContaining({ name: 'Nueva regla', action: 'deny', protocol: 'any' }),
      ),
    );
  });

  it('alterna el estado de una regla con el switch', async () => {
    render(<FirewallPage />);
    await screen.findByText('Bloquear IoT');

    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/firewall/rules/r1', { enabled: false }),
    );
  });

  it('un viewer ve el aviso de solo administrador y no se piden las reglas', async () => {
    setRole('viewer');
    render(<FirewallPage />);
    expect(
      await screen.findByText('Solo el administrador ve las reglas del cortafuegos'),
    ).toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled();
    expect(screen.queryByText(/Aún no hay reglas configuradas/)).not.toBeInTheDocument();
    expect(screen.queryByText('Nueva regla')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Añadir regla/ })).not.toBeInTheDocument();
  });

  it('muestra un banner role="alert" si la carga falla (US-93)', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('boom'));
    render(<FirewallPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar con el servidor/);
    // Un fallo de carga no es «no hay reglas»: no se afirma lo que no se ha comprobado.
    expect(screen.queryByText(/Aún no hay reglas configuradas/)).not.toBeInTheDocument();
    expect(screen.getByText('No se pudieron cargar las reglas')).toBeInTheDocument();
  });

  it('muestra el estado vacío honesto sin reglas (US-93)', async () => {
    mockApi([]);
    render(<FirewallPage />);
    expect(await screen.findByText(/Aún no hay reglas configuradas/)).toBeInTheDocument();
  });
});

describe('FirewallPage: la fila abrible se anuncia en el idioma activo', () => {
  beforeEach(() => {
    mockApi([RULE]);
    setRole('admin');
  });
  afterEach(() => setLocale('es', { persist: false }));

  it('en español: «Editar la regla …» (verbatim)', async () => {
    render(<FirewallPage />);
    expect(await screen.findByRole('row', { name: 'Editar la regla Bloquear IoT' })).toBeVisible();
  });

  it('en inglés: «Edit rule …», no el literal en español', async () => {
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    render(<FirewallPage />);
    expect(await screen.findByRole('row', { name: 'Edit rule Bloquear IoT' })).toBeVisible();
    expect(screen.queryByRole('row', { name: 'Editar la regla Bloquear IoT' })).toBeNull();
  });

  it('un cambio de idioma en caliente reetiqueta la fila', async () => {
    render(<FirewallPage />);
    await screen.findByRole('row', { name: 'Editar la regla Bloquear IoT' });
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    await waitFor(() =>
      expect(screen.getByRole('row', { name: 'Edit rule Bloquear IoT' })).toBeVisible(),
    );
  });
});

describe('FirewallPage: capacidad de puerta de enlace de este equipo', () => {
  beforeEach(() => {
    apiMock.post.mockReset();
    apiMock.patch.mockReset();
    apiMock.del.mockReset();
    setRole('admin');
  });
  afterEach(() => setLocale('es', { persist: false }));

  it('supported: sin aviso y con el formulario de alta', async () => {
    mockApi([RULE], { status: 'supported' });
    render(<FirewallPage />);
    await screen.findByText('Bloquear IoT');
    expect(screen.getByRole('button', { name: /Añadir regla/ })).toBeInTheDocument();
    expect(screen.queryByText('Este equipo no puede hacer de puerta de enlace')).toBeNull();
    expect(screen.queryByText('Falta instalar el helper de puerta de enlace')).toBeNull();
    expect(apiMock.get).toHaveBeenCalledWith('/firewall/status');
  });

  it('unsupported: avisa de que en Windows hay que usar el cortafuegos del router y no ofrece alta', async () => {
    mockApi([RULE], { status: 'unsupported', reason: 'platform' });
    render(<FirewallPage />);
    await screen.findByText('Bloquear IoT');
    expect(screen.getByText('Este equipo no puede hacer de puerta de enlace')).toBeInTheDocument();
    expect(
      screen.getByText(
        /En Windows, KrakenOS no hace de puerta de enlace.*cortafuegos de tu router/,
      ),
    ).toBeInTheDocument();
    // Ningún control que acabaría en error: ni formulario, ni interruptor activo, ni eliminar.
    expect(screen.queryByRole('button', { name: /Añadir regla/ })).toBeNull();
    expect(screen.queryByLabelText('Nombre')).toBeNull();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Eliminar regla/ })).toBeNull();
  });

  it('requires-setup: dice cómo instalar el helper y no ofrece alta', async () => {
    mockApi([RULE], { status: 'requires-setup', reason: 'helper-missing' });
    render(<FirewallPage />);
    await screen.findByText('Bloquear IoT');
    expect(screen.getByText('Falta instalar el helper de puerta de enlace')).toBeInTheDocument();
    expect(screen.getByText(/install\.sh --with-helper/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Añadir regla/ })).toBeNull();
  });

  it('sin reglas y sin capacidad de crearlas, el vacío no manda a «crear una arriba»', async () => {
    mockApi([], { status: 'unsupported', reason: 'platform' });
    render(<FirewallPage />);
    expect(await screen.findByText(/Aún no hay reglas configuradas/)).toBeInTheDocument();
    expect(screen.queryByText(/Crea una arriba/)).toBeNull();
  });

  it('si no se pudo leer la capacidad no se ofrece alta ni se afirma nada: error visible', async () => {
    apiMock.get
      .mockReset()
      .mockImplementation((path: string) =>
        path === '/firewall/status' ? Promise.reject(new Error('boom')) : Promise.resolve([RULE]),
      );
    render(<FirewallPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo conectar/);
    expect(screen.queryByRole('button', { name: /Añadir regla/ })).toBeNull();
    expect(screen.queryByText('Este equipo no puede hacer de puerta de enlace')).toBeNull();
  });

  it('el aviso sale en inglés con el idioma en inglés', async () => {
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    mockApi([RULE], { status: 'unsupported', reason: 'platform' });
    render(<FirewallPage />);
    expect(await screen.findByText('This computer can’t act as a gateway')).toBeInTheDocument();
    expect(screen.queryByText('Este equipo no puede hacer de puerta de enlace')).toBeNull();
  });
});
