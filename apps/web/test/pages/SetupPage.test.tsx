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
const ApiRequestErrorMock = vi.hoisted(
  () =>
    class ApiRequestError extends Error {
      status: number;
      body?: { code?: string; message?: string };
      constructor(status: number, body?: { code?: string; message?: string }) {
        super(body?.message ?? 'api');
        this.status = status;
        this.body = body;
      }
    },
);
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: ApiRequestErrorMock }));

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
  // El formulario no existe hasta que `/setup/status` responde: pintarlo antes
  // deja rellenar seis campos que la respuesta puede tirar a la basura.
  await user.type(await screen.findByLabelText('Tu nombre'), 'Dueño');
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

    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument();
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

  it('no pinta el formulario mientras comprueba si hace falta configurar', () => {
    apiMock.get.mockReturnValue(new Promise(() => undefined)); // nunca resuelve
    renderPage();

    expect(screen.queryByLabelText('Tu nombre')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAccessibleName('Comprobando la instalación…');
  });

  it('si no puede comprobar el estado, lo dice y deja continuar', async () => {
    apiMock.get.mockRejectedValue(new Error('red'));
    renderPage();

    expect(await screen.findByText(/No se pudo comprobar/)).toBeInTheDocument();
    // Avisa, pero no secuestra el wizard: los campos siguen ahí.
    expect(screen.getByLabelText('Tu nombre')).toBeInTheDocument();
  });

  it('si el sistema ya está configurado al enviar, ofrece ir a iniciar sesión', async () => {
    // Callejón sin salida que había: el 409 pintaba el error y nada más, con el
    // usuario en una pantalla que ya no podía completar.
    apiMock.post.mockRejectedValue(
      new ApiRequestErrorMock(409, {
        code: 'SETUP_ALREADY_DONE',
        message: 'El sistema ya está configurado',
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fill(user, 'password123', 'password123');
    await user.click(screen.getByRole('button', { name: 'Crear administrador' }));

    const salida = await screen.findByRole('button', { name: 'Ir a iniciar sesión' });
    await user.click(salida);
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('un error que no es «ya configurado» no ofrece la salida al login', async () => {
    apiMock.post.mockRejectedValue(
      new ApiRequestErrorMock(409, {
        code: 'SETUP_LOCK_STALE',
        message: 'La configuración quedó bloqueada por un intento anterior.',
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await fill(user, 'password123', 'password123');
    await user.click(screen.getByRole('button', { name: 'Crear administrador' }));

    expect(await screen.findByText(/quedó bloqueada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ir a iniciar sesión' })).not.toBeInTheDocument();
  });
});
