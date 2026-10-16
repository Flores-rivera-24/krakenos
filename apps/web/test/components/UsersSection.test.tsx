import type { UserSummary } from '@krakenos/types';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { UsersSection } from '@/components/settings/UsersSection';
import { Toaster } from '@/components/ui/toast';
import { changeLocale, setLocale } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

function summary(over: Partial<UserSummary> = {}): UserSummary {
  return {
    id: 'u1',
    email: 'ana@krakenos.test',
    displayName: 'Ana',
    role: 'member',
    status: 'active',
    lastLoginAt: null,
    expiresAt: null,
    createdAt: '2026-07-09T10:00:00.000Z',
    ...over,
  };
}

describe('UsersSection — roles del hogar (US-179)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue([summary()]);
    apiMock.post.mockReset().mockResolvedValue(summary());
    useAuthStore.setState({
      user: {
        id: 'admin-1',
        email: 'a@b.c',
        displayName: 'A',
        role: 'admin',
        createdAt: '',
        updatedAt: '',
      },
      tokens: { accessToken: 't', expiresIn: 900 },
    });
    useToastStore.setState({ toasts: [] });
  });

  it('el selector de rol del alta ofrece los 5 roles del hogar', async () => {
    render(
      <>
        <UsersSection />
        <Toaster />
      </>,
    );
    const select = await screen.findByLabelText('Rol');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).toEqual(['Administrador', 'Miembro', 'Menor', 'Invitado', 'Observador']);
  });

  it('elegir «Invitado» muestra la caducidad y la envía como ISO en el alta', async () => {
    const user = userEvent.setup();
    render(
      <>
        <UsersSection />
        <Toaster />
      </>,
    );

    await user.type(await screen.findByLabelText('Email'), 'visita@krakenos.test');
    await user.type(screen.getByLabelText('Nombre'), 'Visita');
    await user.type(screen.getByLabelText('Contraseña inicial'), 'password123');
    await user.selectOptions(screen.getByLabelText('Rol'), 'guest');

    const expires = await screen.findByLabelText('Caduca (invitado)');
    await user.type(expires, '2026-07-10T18:00');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/users',
        expect.objectContaining({
          role: 'guest',
          expiresAt: new Date('2026-07-10T18:00').toISOString(),
        }),
      ),
    );
  });

  it('muestra la caducidad de un invitado en la lista', async () => {
    apiMock.get.mockResolvedValue([
      summary({ role: 'guest', expiresAt: '2026-07-10T18:00:00.000Z' }),
    ]);
    render(
      <>
        <UsersSection />
        <Toaster />
      </>,
    );
    expect(await screen.findByText(/Caduca /)).toBeInTheDocument();
  });
});

describe('UsersSection en inglés: etiquetas de rol', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue([summary()]);
    useAuthStore.setState({
      user: {
        id: 'a',
        email: 'a@b.c',
        displayName: 'A',
        role: 'admin',
        createdAt: '',
        updatedAt: '',
      },
      tokens: { accessToken: 't', expiresIn: 900 },
    });
  });
  afterEach(() => setLocale('es', { persist: false }));

  it('el selector de rol sale en inglés y cambia en caliente con el idioma', async () => {
    render(<UsersSection />);
    const select = await screen.findByLabelText('Rol');
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.textContent)).toEqual([
      'Administrador',
      'Miembro',
      'Menor',
      'Invitado',
      'Observador',
    ]);
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    await waitFor(() => {
      const en = screen.getByLabelText('Role');
      expect(Array.from(en.querySelectorAll('option')).map((o) => o.textContent)).toEqual([
        'Administrator',
        'Member',
        'Child',
        'Guest',
        'Viewer',
      ]);
    });
    // La intro llama al rol por su nombre (“Viewer”), no «View only».
    expect(screen.getByText(/“Viewer” sees the status/)).toBeInTheDocument();
    expect(screen.queryByText(/View only/)).not.toBeInTheDocument();
  });
});
