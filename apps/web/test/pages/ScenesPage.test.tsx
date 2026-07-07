import type { IotDevice, Scene } from '@krakenos/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

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
  reading: null,
};

function scene(over: Partial<Scene> = {}): Scene {
  return { id: 's1', name: 'Buenas noches', icon: 'night', actions: [{ deviceId: 'light-salon', on: false }], order: 0, createdAt: '', ...over };
}

function asRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
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

  it('crea una escena desde una plantilla (preselecciona la luz)', async () => {
    apiMock.post.mockResolvedValue(scene());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Buenas noches/ }));
    const dialog = await screen.findByRole('dialog');
    // La plantilla "Buenas noches" incluye la luz apagada.
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/scenes', expect.objectContaining({
      name: 'Buenas noches',
      icon: 'night',
      actions: [expect.objectContaining({ deviceId: 'light-salon', on: false })],
    })));
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
});
