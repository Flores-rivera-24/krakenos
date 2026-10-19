import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El layout cablea el indicador de conexión (US-94) → socket falso para evitar
// abrir un socket real en jsdom.
const fakeSocket = vi.hoisted(() => ({
  connected: true,
  active: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  io: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { AppLayout } from '@/components/layout/AppLayout';
import { DomainGate } from '@/components/integrations/DomainNotice';
import { api } from '@/lib/api';
import { useEstadosStore } from '@/lib/integration-states';
import { useAuthStore } from '@/store/auth.store';

const logout = vi.fn();

function renderLayout() {
  return render(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>,
  );
}

describe('AppLayout', () => {
  beforeEach(() => {
    logout.mockReset();
    useAuthStore.setState({
      user: {
        id: 'u',
        email: 'a@b.c',
        displayName: 'Emilio',
        role: 'admin',
        createdAt: '',
        updatedAt: '',
      },
      tokens: { accessToken: 't', expiresIn: 900 },
      logout,
    });
  });

  it('muestra la marca y el nombre del usuario', () => {
    renderLayout();
    expect(screen.getAllByText('KrakenOS').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Emilio')).toBeInTheDocument();
  });

  it('renderiza todas las secciones navegables', () => {
    renderLayout();
    for (const label of [
      'Dashboard',
      'Dispositivos',
      'Red WiFi',
      'VPN',
      'Tráfico',
      'IoT',
      'Cámaras',
      'Firewall',
      'VLANs',
      'QoS',
      'DNS',
      'Ajustes',
    ]) {
      // Cada sección aparece en el sidebar y en la bottom-nav.
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('Firewall enlaza a su ruta (ya no es una sección futura)', () => {
    renderLayout();
    const links = screen.getAllByRole('link', { name: /Firewall/ });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute('href', '/firewall');
    expect(screen.queryByText('Próximamente')).not.toBeInTheDocument();
  });

  it('el botón Salir invoca logout', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getAllByRole('button', { name: 'Salir' })[0]!);
    expect(logout).toHaveBeenCalledOnce();
  });

  it('lee UNA vez el estado de los dominios y lo deja para la barra y las páginas', async () => {
    useEstadosStore.setState({ estados: null });
    const get = vi.spyOn(api, 'get').mockImplementation(
      (path: string) =>
        Promise.resolve(
          path === '/integrations/status'
            ? {
                states: {
                  driver: 'not-configured',
                  vpn: 'not-configured',
                  iot: 'not-configured',
                  cameras: 'not-configured',
                  firewall: 'not-configured',
                  vlan: 'not-configured',
                  qos: 'not-configured',
                  dns: 'not-configured',
                },
              }
            : {},
        ) as never,
    );
    renderLayout();
    await waitFor(() => expect(useEstadosStore.getState().estados?.driver).toBe('not-configured'));
    expect(get.mock.calls.filter(([p]) => p === '/integrations/status')).toHaveLength(1);
    // La etiqueta de la barra lateral lo dice (antes: siempre «—»).
    expect(await screen.findByText('Sin configurar')).toBeInTheDocument();
    get.mockRestore();
  });

  describe('la página no monta hasta saber el estado de los dominios', () => {
    // En una entrada en frío (F5) la página montaba con el estado aún desconocido y pedía los
    // datos de un dominio SIN conectar antes de enterarse: 409 en consola y un error parpadeando.
    const renderConPagina = () =>
      render(
        <MemoryRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<p>contenido de la página</p>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('espera a la primera lectura y entonces monta la página', async () => {
      useEstadosStore.setState({ estados: null, intentado: false });
      let resolver!: (v: unknown) => void;
      vi.spyOn(api, 'get').mockImplementation(
        (path: string) =>
          (path === '/integrations/status'
            ? new Promise((r) => (resolver = r))
            : Promise.resolve({})) as never,
      );
      renderConPagina();
      expect(screen.queryByText('contenido de la página')).not.toBeInTheDocument();
      resolver({ states: { driver: 'not-configured' } });
      expect(await screen.findByText('contenido de la página')).toBeInTheDocument();
    });

    it('si la lectura FALLA, monta la página igualmente (ante la duda, como siempre)', async () => {
      useEstadosStore.setState({ estados: null, intentado: false });
      vi.spyOn(api, 'get').mockImplementation(
        (path: string) =>
          (path === '/integrations/status'
            ? Promise.reject(new Error('red'))
            : Promise.resolve({})) as never,
      );
      renderConPagina();
      expect(await screen.findByText('contenido de la página')).toBeInTheDocument();
    });

    // Camino de fallo del estado de dominios. Un estado DESCONOCIDO no es `not-configured`: si
    // no se pudo leer, la página sale como siempre (con sus datos), no como «Sin configurar»
    // ni como un vacío inventado.
    const renderConGate = () =>
      render(
        <MemoryRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route
                index
                element={
                  <DomainGate domain="dns" title="DNS">
                    <p>cuerpo de DNS</p>
                  </DomainGate>
                }
              />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

    it.each([
      ['red caída', () => Promise.reject(new Error('Failed to fetch'))],
      [
        'el agente responde 5xx',
        () => Promise.reject(Object.assign(new Error('boom'), { status: 503 })),
      ],
      ['forma de respuesta rara', () => Promise.resolve({ otra: 'cosa' })],
    ])(
      '%s: la página monta con sus datos, sin «Sin configurar» ni «demostración»',
      async (_n, fallo) => {
        useEstadosStore.setState({ estados: null, intentado: false });
        vi.spyOn(api, 'get').mockImplementation(((path: string) =>
          path === '/integrations/status' ? fallo() : Promise.resolve({})) as never);
        renderConGate();
        expect(await screen.findByText('cuerpo de DNS')).toBeInTheDocument();
        expect(useEstadosStore.getState().estados).toBeNull();
        expect(screen.queryByText('Sin configurar')).not.toBeInTheDocument();
        expect(screen.queryByText('Datos de demostración')).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Ir a Conectar' })).not.toBeInTheDocument();
      },
    );

    it('durante la espera hay un indicador de carga, no un main vacío', () => {
      useEstadosStore.setState({ estados: null, intentado: false });
      vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}) as never);
      renderConGate();
      expect(screen.queryByText('cuerpo de DNS')).not.toBeInTheDocument();
      expect(within(screen.getByRole('main')).getByRole('status')).toBeInTheDocument();
    });

    it('si el estado se conocía y un refresco posterior falla, se conserva (no pasa a desconocido)', async () => {
      useEstadosStore.setState({ estados: { dns: 'not-configured' }, intentado: true });
      vi.spyOn(api, 'get').mockImplementation((() => Promise.reject(new Error('red'))) as never);
      renderConGate();
      expect(await screen.findByText('Sin configurar')).toBeInTheDocument();
      expect(screen.queryByText('cuerpo de DNS')).not.toBeInTheDocument();
    });

    it('si el agente no contesta, la espera tiene tope (3 s) y no deja la pantalla en blanco', async () => {
      vi.useFakeTimers();
      useEstadosStore.setState({ estados: null, intentado: false });
      vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}) as never);
      renderConPagina();
      expect(screen.queryByText('contenido de la página')).not.toBeInTheDocument();
      expect(within(screen.getByRole('main')).getByRole('status')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
      });
      expect(screen.getByText('contenido de la página')).toBeInTheDocument();
    });
  });
});
