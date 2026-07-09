import type { AutomationRule, IotDevice } from '@krakenos/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));
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
  reading: null,
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
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
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
      screen.getByText(/Cuando aparece un dispositivo desconocido → bloquea el dispositivo del evento/),
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
});
