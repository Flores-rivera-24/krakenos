import type { RoomWithState } from '@krakenos/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { RoomsPage } from '@/pages/RoomsPage';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth.store';
import { useFavoritesStore } from '@/store/favorites.store';
import { useToastStore } from '@/store/toast.store';

function room(over: Partial<RoomWithState> = {}): RoomWithState {
  return {
    id: 'r1',
    name: 'Salón',
    icon: 'living',
    order: 0,
    createdAt: '',
    deviceCount: 2,
    iotCount: 3,
    controllableCount: 2,
    onCount: 1,
    anyUnreachable: false,
    ...over,
  };
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
      <RoomsPage />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('RoomsPage (US-165)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) =>
      path === '/favorites' ? Promise.resolve([]) : Promise.resolve([]),
    );
    apiMock.post.mockReset();
    apiMock.del.mockReset();
    useFavoritesStore.setState({ favorites: [], loaded: true });
    useToastStore.setState({ toasts: [] });
    asRole('admin');
  });

  it('muestra el estado vacío cuando no hay habitaciones', async () => {
    renderPage();
    expect(await screen.findByText(/Aún no has creado ninguna habitación/)).toBeInTheDocument();
  });

  it('rinde un tile con el estado agregado y ejecuta la acción de grupo', async () => {
    apiMock.get.mockImplementation((path: string) =>
      path === '/rooms' ? Promise.resolve([room()]) : Promise.resolve([]),
    );
    apiMock.post.mockResolvedValue({ applied: 2, failed: [] });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Salón')).toBeInTheDocument();
    expect(screen.getByText(/1\/2 encendido/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/rooms/r1/action', { on: false }));
  });

  it('crea una habitación desde el editor', async () => {
    apiMock.post.mockResolvedValue({ id: 'r9', name: 'Cocina', icon: 'kitchen', order: 0, createdAt: '' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Crear la primera habitación' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Cocina');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/rooms', { name: 'Cocina', icon: 'living' }),
    );
  });

  it('un viewer no ve el botón de crear', async () => {
    asRole('viewer');
    renderPage();
    await screen.findByText(/Aún no has creado/);
    expect(screen.queryByRole('button', { name: /Nueva habitación/ })).not.toBeInTheDocument();
  });
});
