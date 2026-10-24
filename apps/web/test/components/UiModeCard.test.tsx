import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    patch: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  };
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
    expect(screen.getByRole('button', { name: /Avanzado/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Sencillo/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('la opción activa lleva un icono de verificación y la inactiva no', () => {
    render(<UiModeCard />);
    const activa = screen.getByRole('button', { name: /Avanzado/ });
    const inactiva = screen.getByRole('button', { name: /Sencillo/ });
    const icono = activa.querySelector('svg.lucide-check');
    expect(icono).not.toBeNull();
    expect(icono).toHaveAttribute('aria-hidden', 'true');
    expect(icono).toHaveAttribute('width', '20');
    expect(inactiva.querySelector('svg')).toBeNull();
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

  it('mientras guarda el foco se queda en el botón: no se deshabilita, se marca aria-disabled', async () => {
    // Un botón que pasa a `disabled` con el foco encima lo suelta y el foco acaba en <body>
    // (el siguiente Tab vuelve al principio de la página).
    let resolver!: (u: unknown) => void;
    apiMock.patch.mockReset().mockReturnValue(new Promise((r) => (resolver = r)));
    render(<UiModeCard />);
    const sencillo = screen.getByRole('button', { name: /Sencillo/ });
    sencillo.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(sencillo).toHaveAttribute('aria-disabled', 'true'));
    expect(sencillo).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Avanzado/ })).not.toBeDisabled();
    expect(sencillo).toHaveFocus();
    // Y el segundo clic durante el guardado no manda otra petición.
    fireEvent.click(screen.getByRole('button', { name: /Avanzado/ }));
    expect(apiMock.patch).toHaveBeenCalledTimes(1);
    resolver({ ...USER, uiMode: 'simple' });
    await waitFor(() => expect(sencillo).toHaveAttribute('aria-disabled', 'false'));
    expect(sencillo).toHaveFocus();
  });
});
