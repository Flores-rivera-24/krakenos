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

const webauthnMock = vi.hoisted(() => ({
  completePasskeyLogin: vi.fn(),
  verifyBackupCode: vi.fn(),
}));
vi.mock('@/lib/webauthn', () => webauthnMock);

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

  /**
   * Rellena el formulario. El correo ya **no** viene prefijado (US-266), así que
   * todo test que envíe el formulario tiene que escribirlo: sin él, el `required`
   * del campo impide el envío y la aserción falla por un motivo que no es el suyo.
   */
  async function fillLogin(
    user: ReturnType<typeof userEvent.setup>,
    email = 'admin@krakenos.local',
    password = 'password123',
  ) {
    await user.type(screen.getByLabelText('Correo electrónico'), email);
    await user.type(screen.getByLabelText('Contraseña'), password);
  }

  it('login correcto navega al dashboard', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ login });
    const user = userEvent.setup();
    renderPage();

    await fillLogin(user);
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith('admin@krakenos.local', 'password123', true),
    );
    expect(navigate).toHaveBeenCalledWith('/');
  });

  // US-266. La pantalla venía con `admin@krakenos.local` escrito en el campo: es
  // la cuenta del `seed` de desarrollo, así que en una instalación real anunciaba
  // el usuario administrador por defecto a cualquiera que abriese la página.
  it('no prefija ningún correo en el campo', async () => {
    renderPage();
    await screen.findByText('Casa de Test');
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('');
  });

  // US-266. La casilla existía desde la primera versión de la pantalla y no
  // viajaba a ningún sitio: se marcaba y no cambiaba absolutamente nada.
  it('manda «Mantener sesión iniciada» al servidor, marcada y sin marcar', async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ login });
    const user = userEvent.setup();
    renderPage();

    // Viene marcada por defecto → viaja `true`.
    await fillLogin(user);
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith(expect.anything(), expect.anything(), true));

    // Al desmarcarla viaja `false`. Se comprueban los DOS valores: con solo el
    // defecto, un componente que ignorase la casilla y mandase `true` fijo pasaría.
    login.mockClear();
    await user.click(screen.getByLabelText('Mantener sesión iniciada'));
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith(expect.anything(), expect.anything(), false),
    );
  });

  it('muestra el mensaje de credenciales ante un 401', async () => {
    useAuthStore.setState({ login: vi.fn().mockRejectedValue(new HttpError(401, 'no')) });
    const user = userEvent.setup();
    renderPage();

    await fillLogin(user, 'admin@krakenos.local', 'mala12345');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith('/');
  });

  it('distingue un error de red del de credenciales (US-55)', async () => {
    useAuthStore.setState({ login: vi.fn().mockRejectedValue(new HttpError(0, 'network')) });
    const user = userEvent.setup();
    renderPage();

    await fillLogin(user);
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument();
    expect(screen.queryByText('Correo o contraseña incorrectos.')).not.toBeInTheDocument();
  });

  it('permite entrar con un código de recuperación en el paso 2FA (US-59)', async () => {
    const session = {
      user: { id: 'u', email: 'a@b.c', displayName: 'A', role: 'admin', createdAt: '', updatedAt: '' },
      tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
    };
    const login = vi.fn().mockResolvedValue({ requiresWebAuthn: true, email: 'a@b.c', mfaToken: 'mt' });
    const setSession = vi.fn();
    useAuthStore.setState({ login, setSession });
    webauthnMock.verifyBackupCode.mockResolvedValue(session);

    const user = userEvent.setup();
    renderPage();

    await fillLogin(user);
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    // Paso 2FA: pasar a código de recuperación, introducirlo y verificar.
    await user.click(await screen.findByText(/Usar un código de recuperación/));
    await user.type(screen.getByLabelText('Código de recuperación'), 'aaaa-bbbb-cccc');
    await user.click(screen.getByRole('button', { name: 'Verificar código' }));

    await waitFor(() =>
      expect(webauthnMock.verifyBackupCode).toHaveBeenCalledWith('a@b.c', 'mt', 'aaaa-bbbb-cccc'),
    );
    expect(setSession).toHaveBeenCalledWith(session);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  /**
   * US-266. Antes no había NADA aquí: quien perdía la contraseña se quedaba
   * mirando el formulario, sin saber que existían vías de vuelta.
   */
  describe('entrar sin la contraseña (US-266)', () => {
    async function abrirPanel(user: ReturnType<typeof userEvent.setup>) {
      renderPage();
      await user.click(await screen.findByRole('button', { name: '¿No puedes entrar?' }));
    }

    it('el código de recuperación emite sesión y entra', async () => {
      const recoverWithCode = vi.fn().mockResolvedValue(undefined);
      useAuthStore.setState({ recoverWithCode });
      const user = userEvent.setup();
      await abrirPanel(user);

      await user.type(screen.getByLabelText('Correo electrónico'), 'yo@krakenos.test');
      await user.type(screen.getByLabelText('Código de recuperación'), 'aaaa-bbbb-cccc');
      await user.click(screen.getByRole('button', { name: 'Entrar con el código' }));

      await waitFor(() =>
        expect(recoverWithCode).toHaveBeenCalledWith('yo@krakenos.test', 'aaaa-bbbb-cccc'),
      );
      expect(navigate).toHaveBeenCalledWith('/');
    });

    it('un código incorrecto se anuncia sin decir si el correo existe', async () => {
      useAuthStore.setState({ recoverWithCode: vi.fn().mockRejectedValue(new HttpError(401, 'no')) });
      const user = userEvent.setup();
      await abrirPanel(user);

      await user.type(screen.getByLabelText('Correo electrónico'), 'yo@krakenos.test');
      await user.type(screen.getByLabelText('Código de recuperación'), 'mal-mal-mal');
      await user.click(screen.getByRole('button', { name: 'Entrar con el código' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Correo o código incorrectos.');
      expect(navigate).not.toHaveBeenCalledWith('/');
    });

    /**
     * Sin códigos guardados el camino NO está en esta pantalla, y decirlo es la
     * diferencia entre un callejón sin salida y una instrucción. El panel tiene
     * que nombrar las dos vías reales: otro admin, o el servidor.
     */
    it('dice qué hacer si no se guardaron códigos', async () => {
      const user = userEvent.setup();
      await abrirPanel(user);
      expect(screen.getByText('¿No tienes códigos?')).toBeInTheDocument();
      expect(screen.getByText(/Ajustes → Usuarios/)).toBeInTheDocument();
      expect(screen.getByText(/desde el servidor/)).toBeInTheDocument();
    });

    it('se puede volver al formulario de contraseña', async () => {
      const user = userEvent.setup();
      await abrirPanel(user);
      expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Volver' }));
      expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    });
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
