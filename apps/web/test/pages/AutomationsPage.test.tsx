import type { AutomationRule, IotDevice } from '@krakenos/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { AutomationsPage } from '@/pages/AutomationsPage';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

const LIGHT: IotDevice = {
  id: 'light-salon',
  name: 'Luz salón',
  kind: 'light',
  room: null,
  reachable: true,
  on: true,
  brightness: 80,
  color: null,
  readings: [],
};

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'r1',
    name: 'Intruso fuera',
    enabled: true,
    trigger: { type: 'device-new' },
    actions: [{ type: 'device-block' }, { type: 'notify', message: 'bloqueado' }],
    cooldownSec: 60,
    createdAt: '2026-07-09T10:00:00.000Z',
    ...over,
  };
}

function asRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', expiresIn: 900 },
  });
}

function mockGets(over: Record<string, unknown> = {}) {
  apiMock.get.mockReset().mockImplementation((path: string) => {
    if (path in over) {
      const value = over[path];
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    }
    if (path === '/iot/devices') return Promise.resolve([LIGHT]);
    return Promise.resolve([]); // /automations, /automations/runs, /inventory/devices, /scenes
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AutomationsPage />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('AutomationsPage (US-167)', () => {
  beforeEach(() => {
    mockGets();
    apiMock.post.mockReset();
    apiMock.patch.mockReset();
    useToastStore.setState({ toasts: [] });
    asRole('admin');
  });

  it('estado vacío con ejemplos y CTA de crear', async () => {
    renderPage();
    expect(await screen.findByText(/Aún no tienes automatizaciones/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear la primera' })).toBeInTheDocument();
  });

  it('lista las reglas como frases legibles y permite pausarlas', async () => {
    mockGets({ '/automations': [rule()] });
    apiMock.patch.mockResolvedValue(rule({ enabled: false }));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Intruso fuera')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Cuando aparece un dispositivo desconocido → bloquea el dispositivo del evento/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Activar Intruso fuera' }));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/automations/r1', { enabled: false }),
    );
  });

  it('crea una regla desde el builder (POST con trigger y acciones)', async () => {
    apiMock.post.mockResolvedValue(rule());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Crear la primera' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Apagar todo');
    await user.selectOptions(within(dialog).getByLabelText('Cuando'), 'time');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/automations',
        expect.objectContaining({
          name: 'Apagar todo',
          trigger: expect.objectContaining({ type: 'time', minute: 20 * 60 }),
          actions: [{ type: 'iot-set', deviceId: 'light-salon', on: true }],
        }),
      ),
    );
  });

  it('el trigger de movimiento permite filtrar por objeto detectado (Frigate, US-214)', async () => {
    apiMock.post.mockResolvedValue(rule());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Crear la primera' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Persona en la entrada');
    await user.selectOptions(within(dialog).getByLabelText('Cuando'), 'motion-detected');
    await user.selectOptions(
      within(dialog).getByLabelText('Objeto detectado (con Frigate)'),
      'person',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/automations',
        expect.objectContaining({
          trigger: { type: 'motion-detected', label: 'person' },
        }),
      ),
    );
  });

  it('crea una rutina solar y declara que necesita la ubicación (US-256)', async () => {
    apiMock.post.mockResolvedValue(rule());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Crear la primera' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Luz al anochecer');
    await user.selectOptions(within(dialog).getByLabelText('Cuando'), 'sun');
    await user.selectOptions(within(dialog).getByLabelText('Suceso solar'), 'sunset');
    const desfase = within(dialog).getByLabelText('Desfase en minutos');
    await user.clear(desfase);
    await user.type(desfase, '-15');

    // Sin lat/long no hay cálculo solar posible: se dice ANTES de guardar, no
    // cuando el usuario se pregunte por qué la luz no se encendió anoche.
    expect(within(dialog).getByText(/ubicación del hogar/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/automations',
        expect.objectContaining({
          trigger: expect.objectContaining({ type: 'sun', event: 'sunset', offsetMin: -15 }),
        }),
      ),
    );
  });

  it('una rutina solar se lee como el suceso, no como una hora (US-256)', async () => {
    mockGets({
      '/automations': [
        rule({
          name: 'Luz al anochecer',
          trigger: { type: 'sun', event: 'sunset', offsetMin: -15, days: [1, 2] },
        }),
      ],
    });
    renderPage();
    // «a las 21:14» sería cierto hoy y falso mañana.
    expect(await screen.findByText(/atardecer −15 min/i)).toBeInTheDocument();
  });

  it('enseña los horarios de control parental y enlaza a donde se editan (US-256)', async () => {
    // La tercera superficie: no se convierten en reglas —son ventanas que se
    // reafirman— pero tienen que VERSE aquí para que «todas mis rutinas» sea cierto.
    mockGets({
      '/access/schedules': [
        {
          id: 'h1',
          name: 'Hora de dormir',
          mac: 'aa:bb:cc:dd:ee:01',
          enabled: true,
          days: [1, 2, 3, 4, 5],
          startMinute: 22 * 60,
          endMinute: 7 * 60,
          personId: null,
          createdAt: '',
        },
      ],
    });
    renderPage();

    expect(await screen.findByText('Horarios de control parental')).toBeInTheDocument();
    expect(screen.getByText(/22:00–07:00/)).toBeInTheDocument();
    const enlace = screen.getByRole('link', { name: 'Editar en el dispositivo' });
    expect(enlace).toHaveAttribute('href', '/inventory');
    // La MAC no se publica en esta lista.
    expect(screen.queryByText(/aa:bb:cc:dd:ee:01/)).not.toBeInTheDocument();
  });

  it('sin horarios de acceso no se enseña una sección vacía (US-256)', async () => {
    renderPage();
    await screen.findByText('Rutinas');
    expect(screen.queryByText('Horarios de control parental')).not.toBeInTheDocument();
  });

  describe('acción de bloqueo o pausa sin aparato', () => {
    const TABLET = { mac: 'aa:bb:cc:dd:ee:09', label: 'Tablet de Marta', hostname: 'tablet' };

    async function abrirConBloqueo(trigger: 'time' | 'device-new') {
      mockGets({ '/inventory/devices': [TABLET] });
      apiMock.post.mockResolvedValue(rule());
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Crear la primera' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Nombre'), 'Sin internet');
      await user.selectOptions(within(dialog).getByLabelText('Cuando'), trigger);
      await user.selectOptions(within(dialog).getByLabelText('Acción 1'), 'device-block');
      return { user, dialog };
    }

    it('sin MAC en el disparador, no se guarda hasta elegir aparato', async () => {
      const { user, dialog } = await abrirConBloqueo('time');
      const objetivo = within(dialog).getByLabelText(
        'Objetivo de la acción 1',
      ) as HTMLSelectElement;
      expect(objetivo.value).toBe('');
      expect(within(dialog).getByRole('option', { name: 'Elige un dispositivo' })).toBeDisabled();
      expect(
        within(dialog).queryByRole('option', { name: 'El dispositivo del evento' }),
      ).not.toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
      expect(
        await within(dialog).findByText('Elige el dispositivo de la acción 1.'),
      ).toBeInTheDocument();
      expect(apiMock.post).not.toHaveBeenCalled();

      await user.selectOptions(objetivo, TABLET.mac);
      await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
      await waitFor(() =>
        expect(apiMock.post).toHaveBeenCalledWith(
          '/automations',
          expect.objectContaining({ actions: [{ type: 'device-block', mac: TABLET.mac }] }),
        ),
      );
    });

    it('cambiar a un disparador sin MAC tras elegir «el dispositivo del evento» exige dispositivo', async () => {
      mockGets({ '/inventory/devices': [TABLET] });
      apiMock.post.mockResolvedValue(rule());
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Crear la primera' }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Nombre'), 'Sin internet');
      await user.selectOptions(within(dialog).getByLabelText('Acción 1'), 'device-block');
      expect(
        within(dialog).getByRole('option', { name: 'El dispositivo del evento' }),
      ).toBeInTheDocument();
      await user.selectOptions(within(dialog).getByLabelText('Cuando'), 'time');

      await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
      expect(
        await within(dialog).findByText('Elige el dispositivo de la acción 1.'),
      ).toBeInTheDocument();
      expect(apiMock.post).not.toHaveBeenCalled();

      await user.selectOptions(
        within(dialog).getByLabelText('Objetivo de la acción 1'),
        TABLET.mac,
      );
      await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
      await waitFor(() =>
        expect(apiMock.post).toHaveBeenCalledWith(
          '/automations',
          expect.objectContaining({ actions: [{ type: 'device-block', mac: TABLET.mac }] }),
        ),
      );
    });

    it('con MAC en el disparador, «el dispositivo del evento» sigue siendo válido', async () => {
      const { user, dialog } = await abrirConBloqueo('device-new');
      expect(
        within(dialog).getByRole('option', { name: 'El dispositivo del evento' }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('option', { name: 'Elige un dispositivo' }),
      ).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
      await waitFor(() =>
        expect(apiMock.post).toHaveBeenCalledWith(
          '/automations',
          expect.objectContaining({ actions: [{ type: 'device-block' }] }),
        ),
      );
    });
  });

  it('muestra el log de ejecuciones con éxito/fallo', async () => {
    mockGets({
      '/automations': [rule()],
      '/automations/runs': [
        {
          id: 'run1',
          ruleId: 'r1',
          event: 'dispositivo desconocido aa:bb',
          ok: false,
          detail: 'device-block: no encontrado',
          createdAt: '2026-07-09T10:00:00.000Z',
        },
      ],
    });
    renderPage();
    expect(await screen.findByText(/Últimas ejecuciones/)).toBeInTheDocument();
    expect(screen.getByText(/Intruso fuera · dispositivo desconocido aa:bb/)).toBeInTheDocument();
    expect(screen.getByText('device-block: no encontrado')).toBeInTheDocument();
  });

  it('una ejecución fallida se identifica por nombre accesible, no solo por un glifo', async () => {
    mockGets({
      '/automations': [rule()],
      '/automations/runs': [
        {
          id: 'run1',
          ruleId: 'r1',
          event: 'x',
          ok: false,
          detail: null,
          createdAt: '2026-07-09T10:00:00.000Z',
        },
        {
          id: 'run2',
          ruleId: 'r1',
          event: 'y',
          ok: true,
          detail: null,
          createdAt: '2026-07-09T10:01:00.000Z',
        },
      ],
    });
    renderPage();
    expect(await screen.findByRole('img', { name: 'Ejecución fallida' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ejecución correcta' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[✓✕]/);
  });

  it('un viewer no ve el botón de crear ni los switches', async () => {
    asRole('viewer');
    mockGets({ '/automations': [rule()] });
    renderPage();
    await screen.findByText('Intruso fuera');
    expect(screen.queryByRole('button', { name: /Nueva automatización/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('un error de carga muestra el banner sin dejar el Skeleton', async () => {
    mockGets({ '/automations': new Error('boom') });
    const { container } = renderPage();
    await screen.findByText(/No se pudo conectar con el servidor/);
    expect(container.querySelector('.kr-shimmer')).toBeNull();
  });

  describe('listas de opciones que fallan', () => {
    const casos: [string, string, string][] = [
      [
        '/iot/devices',
        'aparatos IoT',
        'No se pudieron cargar los aparatos IoT; la lista puede estar incompleta.',
      ],
      [
        '/inventory/devices',
        'aparatos de red',
        'No se pudieron cargar los aparatos de red; la lista puede estar incompleta.',
      ],
      ['/scenes', 'escenas', 'No se pudieron cargar las escenas; la lista puede estar incompleta.'],
      [
        '/cameras',
        'cámaras',
        'No se pudieron cargar las cámaras; la lista puede estar incompleta.',
      ],
      [
        '/users',
        'usuarios',
        'No se pudieron cargar los usuarios; la lista puede estar incompleta.',
      ],
    ];
    for (const [ruta, , frase] of casos) {
      it(`si ${ruta} falla, el editor lo dice`, async () => {
        mockGets({ [ruta]: new Error('x') });
        const user = userEvent.setup();
        renderPage();
        await user.click(await screen.findByRole('button', { name: 'Crear la primera' }));
        const dialog = await screen.findByRole('dialog');
        expect(await within(dialog).findByText(frase)).toBeInTheDocument();
      });
    }

    it('una lista que falló y se vuelve a leer bien limpia su aviso', async () => {
      let escenasFallan = true;
      mockGets({ '/automations': [rule()] });
      const base = apiMock.get.getMockImplementation()!;
      apiMock.get.mockImplementation((path: string) =>
        path === '/scenes' && escenasFallan ? Promise.reject(new Error('x')) : base(path),
      );
      apiMock.patch.mockResolvedValue(rule({ enabled: false }));
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Intruso fuera');
      escenasFallan = false;
      await user.click(screen.getByRole('switch', { name: 'Activar Intruso fuera' }));
      await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
      await user.click(await screen.findByRole('button', { name: /Nueva automatización/ }));
      const dialog = await screen.findByRole('dialog');
      await within(dialog).findByLabelText('Nombre');
      expect(within(dialog).queryByText(/la lista puede estar incompleta/)).not.toBeInTheDocument();
    });

    it('con todas las listas bien, el editor no avisa de nada', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Crear la primera' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByText(/la lista puede estar incompleta/)).not.toBeInTheDocument();
    });

    it('si falla el historial de ejecuciones, la página lo dice', async () => {
      mockGets({ '/automations/runs': new Error('x') });
      renderPage();
      expect(
        await screen.findByText('No se pudo cargar el historial de ejecuciones.'),
      ).toBeInTheDocument();
    });

    it('los avisos permanentes de lista caída de la página no son alertas', async () => {
      mockGets({
        '/access/schedules': new Error('x'),
        '/automations/runs': new Error('x'),
      });
      renderPage();
      await screen.findByText('No se pudo cargar el historial de ejecuciones.');
      await screen.findByText(
        'No se pudieron cargar los horarios de acceso; puede faltar alguna rutina.',
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('si fallan los horarios de acceso, la página lo dice', async () => {
      mockGets({ '/access/schedules': new Error('x') });
      renderPage();
      expect(
        await screen.findByText(
          'No se pudieron cargar los horarios de acceso; puede faltar alguna rutina.',
        ),
      ).toBeInTheDocument();
    });
  });
});
