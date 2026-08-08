import type { Scene } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), post: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { ScenesWidget } from '@/components/dashboard/widgets/ScenesWidget';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

const SCENE: Scene = { id: 's1', name: 'Cine', icon: 'movie', actions: [], order: 0, createdAt: '' };

function renderWidget() {
  return render(
    <MemoryRouter>
      <ScenesWidget />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('ScenesWidget (US-166)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u', email: 'a@b.c', displayName: 'A', role: 'admin', createdAt: '', updatedAt: '' },
      tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
    });
    useToastStore.setState({ toasts: [] });
    apiMock.post.mockReset();
  });

  it('sin escenas invita a crear la primera', async () => {
    apiMock.get.mockReset().mockResolvedValue([]);
    renderWidget();
    expect(await screen.findByText(/Crea tu primera escena/)).toBeInTheDocument();
  });

  it('lista escenas y las ejecuta de un toque (POST run)', async () => {
    apiMock.get.mockReset().mockResolvedValue([SCENE]);
    apiMock.post.mockResolvedValue({ applied: 0, failed: [] });
    const user = userEvent.setup();
    renderWidget();

    await user.click(await screen.findByRole('button', { name: /Cine/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/scenes/s1/run'));
  });
});
