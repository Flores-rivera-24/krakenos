import type { IotDevice, Scene } from '@krakenos/types';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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
    put: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { changeLocale, setLocale } from '@/lib/i18n';
import { ScenesPage } from '@/pages/ScenesPage';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth.store';
import { useFavoritesStore } from '@/store/favorites.store';
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

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    name: 'Buenas noches',
    icon: 'night',
    actions: [{ deviceId: 'light-salon', on: false }],
    order: 0,
    createdAt: '',
    ...over,
  };
}

function asRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', expiresIn: 900 },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ScenesPage />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('ScenesPage (US-166)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/iot/devices') return Promise.resolve([LIGHT]);
      return Promise.resolve([]); // /scenes, /favorites
    });
    apiMock.post.mockReset();
    useFavoritesStore.setState({ favorites: [], loaded: true });
    useToastStore.setState({ toasts: [] });
    asRole('admin');
  });

  it('estado vacío ofrece plantillas sugeridas', async () => {
    renderPage();
    expect(await screen.findByText(/Aún no tienes escenas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Buenas noches/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cine/ })).toBeInTheDocument();
  });

  it('las plantillas llevan un svg oculto en vez de emoji', async () => {
    renderPage();
    const cine = await screen.findByRole('button', { name: /Cine/ });
    expect(cine.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(cine.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('concuerda en número: «1 dispositivo» y «2 dispositivos»', async () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/iot/devices') return Promise.resolve([LIGHT]);
      if (path === '/scenes') {
        return Promise.resolve([
          scene(),
          scene({
            id: 's2',
            name: 'Cine',
            actions: [
              { deviceId: 'light-salon', on: false },
              { deviceId: 'tv', on: true },
            ],
          }),
        ]);
      }
      return Promise.resolve([]);
    });
    renderPage();
    expect(await screen.findByText('1 dispositivo')).toBeInTheDocument();
    expect(screen.getByText('2 dispositivos')).toBeInTheDocument();
    expect(screen.queryByText(/dispositivo\(s\)/)).not.toBeInTheDocument();
  });

  it('crea una escena desde una plantilla (preselecciona la luz)', async () => {
    apiMock.post.mockResolvedValue(scene());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Buenas noches/ }));
    const dialog = await screen.findByRole('dialog');
    // La plantilla "Buenas noches" incluye la luz apagada.
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/scenes',
        expect.objectContaining({
          name: 'Buenas noches',
          icon: 'night',
          actions: [expect.objectContaining({ deviceId: 'light-salon', on: false })],
        }),
      ),
    );
  });

  describe('en inglés', () => {
    afterEach(() => setLocale('es', { persist: false }));

    it('la plantilla se pinta en inglés y guarda el nombre YA resuelto en ese idioma', async () => {
      await act(async () => {
        await changeLocale('en', { persist: false });
      });
      apiMock.post.mockResolvedValue(scene({ name: 'Good night' }));
      const user = userEvent.setup();
      renderPage();

      await user.click(await screen.findByRole('button', { name: /Good night/ }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(apiMock.post).toHaveBeenCalledWith(
          '/scenes',
          expect.objectContaining({ name: 'Good night', icon: 'night' }),
        ),
      );
    });
  });

  it('ejecuta una escena desde su tarjeta (POST run)', async () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/scenes') return Promise.resolve([scene()]);
      if (path === '/iot/devices') return Promise.resolve([LIGHT]);
      return Promise.resolve([]);
    });
    apiMock.post.mockResolvedValue({ applied: 1, failed: [] });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Activar' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/scenes/s1/run'));
  });

  it('un viewer no ve el botón de crear', async () => {
    asRole('viewer');
    renderPage();
    await screen.findByText(/Aún no tienes escenas/);
    expect(screen.queryByRole('button', { name: /Nueva escena/ })).not.toBeInTheDocument();
  });

  it('un error de carga muestra el banner y no deja el Skeleton para siempre (US-207)', async () => {
    apiMock.get.mockImplementation((path: string) =>
      path === '/scenes' ? Promise.reject(new Error('boom')) : Promise.resolve([]),
    );
    const { container } = renderPage();
    await screen.findByText(/No se pudo conectar con el servidor/);
    expect(container.querySelector('.kr-shimmer')).toBeNull();
    // Y el estado vacío ("aún no tienes escenas") no debe mentir bajo el error.
    expect(screen.queryByText(/Aún no tienes escenas/)).not.toBeInTheDocument();
  });

  it('si fallan los dispositivos IoT lo dice en vez de fingir que no hay (US-207)', async () => {
    apiMock.get.mockImplementation((path: string) =>
      path === '/iot/devices' ? Promise.reject(new Error('bridge caído')) : Promise.resolve([]),
    );
    renderPage();
    await screen.findByText(/No se pudo conectar con el servidor/);
  });

  it('el editor no crashea si los dispositivos llegan después de abrirlo (US-207)', async () => {
    let resolveDevices: (d: IotDevice[]) => void = () => undefined;
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/iot/devices') return new Promise((res) => (resolveDevices = res));
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    renderPage();

    // Abre el editor ANTES de que llegue el snapshot de dispositivos.
    await user.click(await screen.findByRole('button', { name: 'Crear escena' }));
    await screen.findByText(/No hay luces ni enchufes/);

    // Los dispositivos llegan tarde: el editor debe pintarlos sin TypeError.
    resolveDevices([LIGHT]);
    await screen.findByLabelText(`Incluir ${LIGHT.name}`);
  });

  it('pulsar el nombre del aparato marca la casilla y no toca el estado; el Switch no va dentro del label', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Crear escena' }));
    const casilla = await screen.findByLabelText(`Incluir ${LIGHT.name}`);
    await user.click(casilla); // incluir el aparato: aparece su interruptor
    expect(casilla).toBeChecked();
    const interruptor = screen.getByRole('switch', {
      name: `Estado de ${LIGHT.name} en la escena`,
    });
    const estado = interruptor.getAttribute('aria-checked');

    // Clic en el interruptor: cambia el estado y la casilla sigue marcada.
    await user.click(interruptor);
    expect(interruptor).toHaveAttribute('aria-checked', estado === 'true' ? 'false' : 'true');
    expect(casilla).toBeChecked();

    // Clic en el nombre: desmarca la casilla y el interruptor desaparece.
    await user.click(screen.getByText(LIGHT.name, { selector: 'span' }));
    expect(casilla).not.toBeChecked();
    expect(
      screen.queryByRole('switch', { name: `Estado de ${LIGHT.name} en la escena` }),
    ).toBeNull();
  });

  it('el Switch de estado no está dentro de un <label>', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Crear escena' }));
    await user.click(await screen.findByLabelText(`Incluir ${LIGHT.name}`));
    const interruptor = screen.getByRole('switch', {
      name: `Estado de ${LIGHT.name} en la escena`,
    });
    expect(interruptor.closest('label')).toBeNull();
  });
});
