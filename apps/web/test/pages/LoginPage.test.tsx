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
import { HttpError, useAuthStore } from '@/store/auth.store';

/** Respuestas por defecto de los endpoints públicos del card. */
function defaultApi(path: string): Promise<unknown> {
  if (path === '/setup/status') return Promise.resolve({ needsSetup: false });
  if (path === '/system/info') return Promise.resolve({ homeName: 'Casa de Test', version: '1.0.0' });
  if (path === '/auth/last-session') return Promise.resolve(null);
  return Promise.resolve({});
}

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
    apiMock.get.mockReset().mockImplementation(defaultApi);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    useAuthStore.setState({ user: null, login: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirige al wizard si el sistema necesita configuración', async () => {
    apiMock.get.mockImplementation((path: string) =>
      path === '/setup/status' ? Promise.resolve({ needsSetup: true }) : defaultApi(path),
    );
    renderPage();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/setup', { replace: true }));
  });

  it('login correcto navega al dashboard', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ login });
    const user = userEvent.setup();
    renderPage();

    await user.clear(screen.getByLabelText('Correo electrónico'));
    await user.type(screen.getByLabelText('Correo electrónico'), 'admin@krakenos.local');
    await user.type(screen.getByLabelText('Contraseña'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('admin@krakenos.local', 'password123'));
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('muestra el mensaje de credenciales ante un 401', async () => {
    useAuthStore.setState({ login: vi.fn().mockRejectedValue(new HttpError(401, 'no')) });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Contraseña'), 'mala12345');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith('/');
  });

  it('distingue un error de red del de credenciales (US-55)', async () => {
    useAuthStore.setState({ login: vi.fn().mockRejectedValue(new HttpError(0, 'network')) });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Contraseña'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument();
    expect(screen.queryByText('Correo o contraseña incorrectos.')).not.toBeInTheDocument();
  });

  it('muestra el nombre del hogar de system/info', async () => {
    renderPage();
    expect(await screen.findByText('Casa de Test')).toBeInTheDocument();
  });

  it('muestra "Sin conexión" si /health falla', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    renderPage();
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument();
  });

  it('no muestra el footer si last-session devuelve null', async () => {
    renderPage();
    // Espera a que la carga del card termine (el nombre del hogar ya está).
    await screen.findByText('Casa de Test');
    expect(screen.queryByText(/Último acceso:/)).not.toBeInTheDocument();
  });

  it('muestra el footer con la última sesión si existe', async () => {
    apiMock.get.mockImplementation((path: string) =>
      path === '/auth/last-session'
        ? Promise.resolve({ timestamp: new Date().toISOString(), ip: '192.168.1.50' })
        : defaultApi(path),
    );
    renderPage();
    expect(await screen.findByText(/Último acceso:/)).toBeInTheDocument();
    expect(screen.getByText('192.168.1.50')).toBeInTheDocument();
  });
});
