import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), patch: vi.fn(), post: vi.fn(), del: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { UiModeCard } from '@/components/settings/UiModeCard';
import { useAuthStore } from '@/store/auth.store';

const USER = {
  id: 'u',
  email: 'a@b.c',
  displayName: 'A',
  role: 'member' as const,
  uiMode: 'advanced' as const,
  createdAt: '',
  updatedAt: '',
};

describe('UiModeCard (US-176)', () => {
  beforeEach(() => {
    apiMock.patch.mockReset().mockResolvedValue({ ...USER, uiMode: 'simple' });
    useAuthStore.setState({ user: USER });
  });

  it('marca el modo actual como seleccionado', () => {
    render(<UiModeCard />);
    expect(screen.getByRole('button', { name: /Avanzado/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Sencillo/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('cambiar de modo llama al PATCH de autoservicio y actualiza el store', async () => {
    render(<UiModeCard />);
    await userEvent.click(screen.getByRole('button', { name: /Sencillo/ }));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/auth/ui-mode', { uiMode: 'simple' }),
    );
    expect(useAuthStore.getState().user?.uiMode).toBe('simple');
  });

  it('si el servidor falla, el modo no cambia y se avisa', async () => {
    apiMock.patch.mockRejectedValue(new Error('boom'));
    render(<UiModeCard />);
    await userEvent.click(screen.getByRole('button', { name: /Sencillo/ }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    expect(useAuthStore.getState().user?.uiMode).toBe('advanced');
  });
});
