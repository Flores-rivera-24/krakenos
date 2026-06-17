import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouter from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => {
  const actual = (await orig()) as typeof ReactRouter;
  return { ...actual, useNavigate: () => navigate };
});

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { SetupPage } from '@/pages/SetupPage';
import { useAuthStore } from '@/store/auth.store';

const LOGIN_RESPONSE = {
  user: { id: 'u', email: 'o@k.test', displayName: 'O', role: 'admin' as const, createdAt: '', updatedAt: '' },
  tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <SetupPage />
    </MemoryRouter>,
  );
}

async function fill(user: ReturnType<typeof userEvent.setup>, password: string, confirm: string) {
  await user.type(screen.getByLabelText('Tu nombre'), 'Dueño');
  await user.type(screen.getByLabelText('Email'), 'o@k.test');
  await user.type(screen.getByLabelText('Contraseña'), password);
  await user.type(screen.getByLabelText('Confirmar contraseña'), confirm);
}

describe('SetupPage', () => {
  beforeEach(() => {
    navigate.mockClear();
    apiMock.get.mockReset().mockResolvedValue({ needsSetup: true });
    apiMock.post.mockReset().mockResolvedValue(LOGIN_RESPONSE);
    useAuthStore.setState({ setSession: vi.fn() });
  });

  it('redirige a login si el sistema ya está configurado', async () => {
    apiMock.get.mockResolvedValue({ needsSetup: false });
    renderPage();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }));
  });

  it('error si las contraseñas no coinciden (sin llamar a la API)', async () => {
    const user = userEvent.setup();
    renderPage();
    await fill(user, 'password123', 'distinta1');
    await user.click(screen.getByRole('button', { name: 'Crear administrador' }));

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('error si la contraseña es demasiado corta', async () => {
    const user = userEvent.setup();
    renderPage();
    // minLength del input no bloquea programáticamente type(); validamos la lógica.
    await fill(user, 'corta', 'corta');
    await user.click(screen.getByRole('button', { name: 'Crear administrador' }));

    expect(await screen.findByText(/al menos 8 caracteres/)).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('éxito: crea admin (anónimo), fija sesión y va al dashboard', async () => {
    const setSession = vi.fn();
    useAuthStore.setState({ setSession });
    const user = userEvent.setup();
    renderPage();

    await fill(user, 'password123', 'password123');
    await user.click(screen.getByRole('button', { name: 'Crear administrador' }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    const [path, , opts] = apiMock.post.mock.calls[0];
    expect(path).toBe('/setup/init');
    expect(opts).toMatchObject({ anonymous: true });
    expect(setSession).toHaveBeenCalledWith(LOGIN_RESPONSE);
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });
});
