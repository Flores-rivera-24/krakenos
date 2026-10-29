import type { AuthSession, SystemSettingKey } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), post: vi.fn(), del: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

const webauthnMock = vi.hoisted(() => ({
  isWebAuthnSupported: vi.fn(() => true),
  startRegistration: vi.fn(),
}));
vi.mock('@/lib/webauthn', () => webauthnMock);

import { SecuritySection } from '@/components/settings/SecuritySection';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { applyTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

const SESSIONS: AuthSession[] = [
  {
    id: 's1',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1e9).toISOString(),
  },
  {
    id: 's2',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1e9).toISOString(),
  },
];

const SETTINGS = {
  homeName: 'Casa',
  timezone: 'UTC',
  scanIntervalSec: '60',
  trafficRetentionDays: '7',
  auditRetentionDays: '90',
  accessTokenTtl: '900',
  loginRateLimit: '10',
  theme: 'dark',
} as Record<SystemSettingKey, string>;

function renderSection(isAdmin = true, patch = vi.fn(), settings = SETTINGS) {
  return render(
    <MemoryRouter>
      <SecuritySection
        settings={settings}
        patch={patch}
        isAdmin={isAdmin}
        ajustesPendientes={null}
      />
    </MemoryRouter>,
  );
}

describe('SecuritySection', () => {
  it.each([
    ['Duración del access token', 'combobox'],
    ['Límite de intentos de login', 'combobox'],
    ['Tema oscuro', 'switch'],
  ])('pulsar la etiqueta «%s» enfoca su control', async (texto, rol) => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByText(texto));
    expect(document.activeElement).toBe(screen.getByRole(rol, { name: texto }));
  });

  // Pulsar «Tema oscuro» alterna el tema real del documento: se devuelve al de partida.
  afterEach(() => applyTheme('dark'));

  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    apiMock.get
      .mockReset()
      .mockImplementation((path: string) =>
        Promise.resolve(path === '/webauthn/credentials' ? [] : SESSIONS),
      );
    apiMock.post.mockReset().mockResolvedValue(undefined);
    apiMock.del.mockReset().mockResolvedValue(undefined);
    webauthnMock.isWebAuthnSupported.mockReset().mockReturnValue(true);
    useAuthStore.setState({
      user: {
        id: 'u',
        email: 'a@b.c',
        displayName: 'A',
        role: 'admin',
        createdAt: '',
        updatedAt: '',
      },
      tokens: { accessToken: 't', expiresIn: 900 },
      logout: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('lista las sesiones activas y permite revocar una', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/auth/sessions'));
    const revokeButtons = await screen.findAllByRole('button', {
      name: /^Revocar la sesión creada/,
    });
    expect(revokeButtons).toHaveLength(2);
    await user.click(revokeButtons[0]!);
    expect(apiMock.del).toHaveBeenCalledWith('/auth/sessions/s1');
  });

  it('«Cerrar las demás sesiones» pide confirmar, cierra las demás (la actual se identifica por cookie, US-91) y avisa', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Cerrar las demás sesiones' }));
    // El primer clic solo arma: antes mandaba el DELETE de golpe y sin decir nada.
    expect(apiMock.del).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(apiMock.del).toHaveBeenCalledWith('/auth/sessions'));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({
          kind: 'success',
          message: 'Se han cerrado las demás sesiones; esta sigue abierta',
        }),
      ]),
    );
  });

  it('si el servidor falla al cerrar las demás sesiones, se dice y no queda una promesa rechazada', async () => {
    const user = userEvent.setup();
    apiMock.del.mockRejectedValue(new Error('boom'));
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Cerrar las demás sesiones' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ kind: 'error' })]),
    );
  });

  it('la zona de peligro pide confirmación antes de regenerar las claves', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Regenerar claves RS256' }));
    // Aparece el diálogo de confirmación; aún no se ha llamado al endpoint.
    expect(screen.getByText('¿Regenerar las claves RS256?')).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sí, regenerar' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/system/regen-keys'));
  });

  it('un viewer no ve la zona de peligro', () => {
    renderSection(false);
    expect(screen.queryByText('Zona de peligro')).not.toBeInTheDocument();
  });

  it('la subsección "Passkeys" renderiza con lista vacía', async () => {
    renderSection();
    expect(screen.getByText('Passkeys')).toBeInTheDocument();
    expect(await screen.findByText(/Sin passkeys registradas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Añadir passkey' })).toBeInTheDocument();
  });

  it('el botón "Añadir passkey" no aparece si isWebAuthnSupported() es false', () => {
    webauthnMock.isWebAuthnSupported.mockReturnValue(false);
    renderSection();
    expect(screen.getByText('Passkeys')).toBeInTheDocument();
    expect(screen.getByText('Tu navegador no admite passkeys.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Añadir passkey' })).not.toBeInTheDocument();
  });

  it('regenera los códigos de recuperación y los muestra una sola vez (US-59)', async () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/webauthn/credentials')
        return Promise.resolve([
          {
            id: 'k1',
            name: 'iPhone',
            deviceType: 'singleDevice',
            backedUp: false,
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
          },
        ]);
      if (path === '/webauthn/backup-codes') return Promise.resolve({ remaining: 3 });
      return Promise.resolve(SESSIONS);
    });
    apiMock.post.mockImplementation((path: string) =>
      path === '/webauthn/backup-codes'
        ? Promise.resolve({ codes: ['aaaa-bbbb-cccc', 'dddd-eeee-ffff'] })
        : Promise.resolve(undefined),
    );

    const user = userEvent.setup();
    renderSection();

    const regen = await screen.findByRole('button', { name: 'Regenerar códigos' });
    await user.click(regen);

    expect(await screen.findByText('aaaa-bbbb-cccc')).toBeInTheDocument();
    expect(screen.getByText('dddd-eeee-ffff')).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith('/webauthn/backup-codes');
  });

  it('los códigos de recuperación se copian juntos y se descargan como .txt sin tocar la red', async () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/webauthn/credentials')
        return Promise.resolve([
          {
            id: 'k1',
            name: 'iPhone',
            deviceType: 'singleDevice',
            backedUp: false,
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
          },
        ]);
      if (path === '/webauthn/backup-codes') return Promise.resolve({ remaining: 3 });
      return Promise.resolve(SESSIONS);
    });
    apiMock.post.mockImplementation((path: string) =>
      path === '/webauthn/backup-codes'
        ? Promise.resolve({ codes: ['aaaa-bbbb-cccc', 'dddd-eeee-ffff'] })
        : Promise.resolve(undefined),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:codigos';
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Regenerar códigos' }));
    await screen.findByText('aaaa-bbbb-cccc');

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: /copiar/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('aaaa-bbbb-cccc\ndddd-eeee-ffff'));

    await user.click(screen.getByRole('button', { name: 'Descargar como .txt' }));
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toMatch(/^text\/plain/);
    expect(await blobs[0]!.text()).toBe('aaaa-bbbb-cccc\ndddd-eeee-ffff');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:codigos');
    // La descarga no pide nada al servidor.
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('cambiar el TTL del token guarda y avisa con «Cambios guardados.»', async () => {
    const patch = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    renderSection(true, patch);
    await user.selectOptions(await screen.findByLabelText(/duración del access token/i), '3600');
    expect(patch).toHaveBeenCalledWith('accessTokenTtl', '3600');
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ kind: 'success', message: 'Cambios guardados.' }),
      ]),
    );
  });

  const PASSKEY = {
    id: 'k1',
    name: 'iPhone',
    deviceType: 'singleDevice',
    backedUp: false,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  function conPasskey(over: Record<string, () => Promise<unknown>> = {}) {
    apiMock.get.mockImplementation((path: string) => {
      const o = over[path];
      if (o) return o();
      if (path === '/webauthn/credentials') return Promise.resolve([PASSKEY]);
      if (path === '/webauthn/backup-codes') return Promise.resolve({ remaining: 3 });
      return Promise.resolve(SESSIONS);
    });
  }
  const toastError = () =>
    waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ kind: 'error' })]),
    );

  it('si fallan las passkeys se dice, no se pinta «sin passkeys», y reintentar las carga', async () => {
    const user = userEvent.setup();
    let fallar = true;
    conPasskey({
      '/webauthn/credentials': () =>
        fallar ? Promise.reject(new Error('x')) : Promise.resolve([PASSKEY]),
    });
    renderSection();
    expect(await screen.findByText('No se pudieron cargar las passkeys.')).toBeInTheDocument();
    expect(screen.queryByText(/Sin passkeys registradas/)).not.toBeInTheDocument();
    fallar = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('iPhone')).toBeInTheDocument();
  });

  it('si fallan las sesiones se dice, no se pinta «sin sesiones»', async () => {
    const user = userEvent.setup();
    let fallar = true;
    apiMock.get.mockImplementation((path: string) =>
      path === '/auth/sessions'
        ? fallar
          ? Promise.reject(new Error('x'))
          : Promise.resolve(SESSIONS)
        : Promise.resolve([]),
    );
    renderSection();
    expect(await screen.findByText('No se pudieron cargar las sesiones.')).toBeInTheDocument();
    expect(screen.queryByText('Sin sesiones activas.')).not.toBeInTheDocument();
    fallar = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findAllByRole('button', { name: /^Revocar la sesión/ })).toHaveLength(2);
  });

  it('si falla la cuenta de códigos de recuperación se dice, sin inventar un número', async () => {
    conPasskey({ '/webauthn/backup-codes': () => Promise.reject(new Error('x')) });
    renderSection();
    expect(
      await screen.findByText('No se pudo comprobar cuántos códigos de recuperación quedan.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/te quedan/)).not.toBeInTheDocument();
  });

  it('si regenerar códigos falla, avisa y no enseña códigos', async () => {
    const user = userEvent.setup();
    conPasskey();
    apiMock.post.mockRejectedValue(new Error('boom'));
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Regenerar códigos' }));
    await toastError();
    expect(screen.queryByText('Los he guardado')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerar códigos' })).toBeEnabled();
  });

  it('un clic en eliminar una passkey no borra; Confirmar sí', async () => {
    const user = userEvent.setup();
    conPasskey();
    apiMock.del.mockResolvedValue(undefined);
    renderSection();
    await screen.findByText('iPhone');
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(apiMock.del).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(apiMock.del).toHaveBeenCalledTimes(1));
  });

  it('si borrar una passkey falla, avisa y la passkey sigue en la lista', async () => {
    const user = userEvent.setup();
    conPasskey();
    apiMock.del.mockRejectedValue(new Error('boom'));
    renderSection();
    await screen.findByText('iPhone');
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await toastError();
    expect(screen.getByText('iPhone')).toBeInTheDocument();
  });

  it('si revocar una sesión falla, avisa y la sesión sigue en la lista', async () => {
    const user = userEvent.setup();
    apiMock.del.mockRejectedValue(new Error('boom'));
    renderSection();
    const botones = await screen.findAllByRole('button', { name: /^Revocar la sesión/ });
    await user.click(botones[0]!);
    await toastError();
    expect(screen.getAllByRole('button', { name: /^Revocar la sesión/ })).toHaveLength(2);
  });

  it('si regenerar las claves falla, el diálogo sigue abierto con el error y no se cierra la sesión', async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ logout });
    apiMock.post.mockRejectedValue(new Error('boom'));
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Regenerar claves RS256' }));
    await user.click(screen.getByRole('button', { name: 'Sí, regenerar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('¿Regenerar las claves RS256?')).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });

  it('si las sesiones fallan tras un éxito, se conservan y se marcan como viejas, no como vacías', async () => {
    const user = userEvent.setup();
    let fallar = false;
    apiMock.get.mockImplementation((path: string) =>
      path === '/auth/sessions'
        ? fallar
          ? Promise.reject(new Error('x'))
          : Promise.resolve(SESSIONS)
        : Promise.resolve([]),
    );
    apiMock.del.mockResolvedValue(undefined);
    renderSection();
    const botones = await screen.findAllByRole('button', { name: /^Revocar la sesión/ });
    fallar = true;
    await user.click(botones[0]!);
    await waitFor(() => expect(screen.getByText('Datos obsoletos')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /^Revocar la sesión/ })).toHaveLength(2);
    expect(screen.queryByText('Sin sesiones activas.')).not.toBeInTheDocument();
  });

  it('si reintentar vuelve a fallar, el error sigue y el botón sigue operativo', async () => {
    const user = userEvent.setup();
    apiMock.get.mockImplementation((path: string) =>
      path === '/auth/sessions' ? Promise.reject(new Error('x')) : Promise.resolve([]),
    );
    renderSection();
    await screen.findByText('No se pudieron cargar las sesiones.');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('No se pudieron cargar las sesiones.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
    expect(apiMock.get.mock.calls.filter((c) => c[0] === '/auth/sessions').length).toBe(2);
  });

  it('si el recuento de códigos falla tras un éxito, se conserva y se marca como viejo', async () => {
    const user = userEvent.setup();
    let fallar = false;
    conPasskey({
      '/webauthn/backup-codes': () =>
        fallar ? Promise.reject(new Error('x')) : Promise.resolve({ remaining: 3 }),
    });
    apiMock.post.mockResolvedValue({ codes: ['aaaa-bbbb'] });
    renderSection();
    await screen.findByText(/te quedan 3/);
    fallar = true;
    await user.click(screen.getByRole('button', { name: 'Regenerar códigos' }));
    await screen.findByText('aaaa-bbbb');
    await user.click(screen.getByRole('button', { name: 'Los he guardado' }));
    expect(await screen.findByText(/te quedan 3/)).toBeInTheDocument();
    expect(screen.getByText('Datos obsoletos')).toBeInTheDocument();
  });

  describe('tema', () => {
    it('lee el tema local, no el del servidor, y al cambiarlo no escribe `theme` al servidor', async () => {
      applyTheme('dark');
      const patch = vi.fn();
      renderSection(true, patch, { ...SETTINGS, theme: 'light' });
      const sw = await screen.findByRole('switch', { name: 'Tema oscuro' });
      expect(sw).toHaveAttribute('aria-checked', 'true');
      await userEvent.click(sw);
      expect(sw).toHaveAttribute('aria-checked', 'false');
      expect(patch).not.toHaveBeenCalledWith('theme', expect.anything());
    });

    it('el interruptor y el botón de la barra lateral cambian a la vez', async () => {
      applyTheme('dark');
      render(
        <MemoryRouter>
          <ThemeToggle collapsed={false} />
          <SecuritySection settings={SETTINGS} patch={vi.fn()} isAdmin ajustesPendientes={null} />
        </MemoryRouter>,
      );
      const sw = await screen.findByRole('switch', { name: 'Tema oscuro' });
      await userEvent.click(sw);
      expect(sw).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('button', { name: 'Cambiar a modo oscuro' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Cambiar a modo oscuro' }));
      expect(sw).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('el icono de las passkeys se oculta a los lectores (el título ya las nombra)', async () => {
    renderSection();
    await waitFor(() =>
      expect(document.querySelector('svg.lucide-key-round.text-kr-accent')).not.toBeNull(),
    );
    expect(document.querySelector('svg.lucide-key-round.text-kr-accent')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
