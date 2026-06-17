import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouter from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => {
  const actual = (await orig()) as typeof ReactRouter;
  return { ...actual, useNavigate: () => navigate };
});

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { LoginPage } from '@/pages/LoginPage';
import { useAuthStore } from '@/store/auth.store';

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    navigate.mockClear();
    apiMock.get.mockReset().mockResolvedValue({ needsSetup: false });
    useAuthStore.setState({ login: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirige al wizard si el sistema necesita configuración', async () => {
    apiMock.get.mockResolvedValue({ needsSetup: true });
    renderPage();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/setup', { replace: true }));
  });

  it('login correcto navega al dashboard', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ login });
    const user = userEvent.setup();
    renderPage();

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'admin@krakenos.local');
    await user.type(screen.getByLabelText('Contraseña'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('admin@krakenos.local', 'password123'));
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('login fallido muestra el error y no navega al dashboard', async () => {
    useAuthStore.setState({ login: vi.fn().mockRejectedValue(new Error('nope')) });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Contraseña'), 'mala12345');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith('/');
  });
});
