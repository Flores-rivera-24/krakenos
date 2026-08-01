import type { IotDevice } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));
const fakeSocket = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn() }));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { QuickActionsWidget } from '@/components/dashboard/widgets/QuickActionsWidget';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth.store';
import { useFavoritesStore } from '@/store/favorites.store';
import { useToastStore } from '@/store/toast.store';

const IOT: IotDevice = {
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

function renderWidget() {
  return render(
    <MemoryRouter>
      <QuickActionsWidget />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('QuickActionsWidget (US-170)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/iot/devices') return Promise.resolve([IOT]);
      return Promise.resolve([]); // inventario, rooms, favorites
    });
    apiMock.patch.mockReset().mockResolvedValue(undefined);
    useAuthStore.setState({
      user: { id: 'u', email: 'a@b.c', displayName: 'A', role: 'admin', createdAt: '', updatedAt: '' },
      tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
    });
    useToastStore.setState({ toasts: [] });
  });

  it('sin favoritos muestra el mensaje de ayuda', async () => {
    useFavoritesStore.setState({ favorites: [], loaded: true });
    renderWidget();
    expect(await screen.findByText(/Fija tus dispositivos y habitaciones favoritos/)).toBeInTheDocument();
  });

  it('resuelve un favorito IoT y su toggle llama a PATCH', async () => {
    useFavoritesStore.setState({
      favorites: [{ id: 'f1', kind: 'iot', ref: 'light-salon', order: 0, createdAt: '' }],
      loaded: true,
    });
    const user = userEvent.setup();
    renderWidget();

    expect(await screen.findByText('Luz salón')).toBeInTheDocument();
    // El dispositivo está encendido → el interruptor anuncia la acción real (apagar).
    await user.click(screen.getByRole('switch', { name: /Apagar Luz salón/ }));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/light-salon', { on: false }),
    );
  });

  it('ignora un favorito que ya no existe en el snapshot', async () => {
    useFavoritesStore.setState({
      favorites: [{ id: 'f2', kind: 'iot', ref: 'borrado', order: 0, createdAt: '' }],
      loaded: true,
    });
    renderWidget();
    // El favorito huérfano no se pinta → vuelve al mensaje de ayuda.
    expect(await screen.findByText(/Fija tus dispositivos/)).toBeInTheDocument();
  });
});
