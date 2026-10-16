import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { LanguageCard } from '@/components/settings/LanguageCard';
import { setLocale } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';

const USER = {
  id: 'u',
  email: 'a@b.c',
  displayName: 'A',
  role: 'member' as const,
  uiMode: 'advanced' as const,
  locale: 'es' as const,
  createdAt: '',
  updatedAt: '',
};

describe('LanguageCard (US-177)', () => {
  beforeEach(() => {
    apiMock.patch.mockReset().mockResolvedValue({ ...USER, locale: 'en' });
    useAuthStore.setState({ user: USER });
    setLocale('es', { persist: false });
  });

  afterEach(() => setLocale('es', { persist: false }));

  it('marca el idioma actual como seleccionado', () => {
    render(<LanguageCard />);
    expect(screen.getByRole('button', { name: /Español/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /English/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('cambiar de idioma llama al PATCH de autoservicio, actualiza el store y aplica el idioma', async () => {
    render(<LanguageCard />);
    await userEvent.click(screen.getByRole('button', { name: /English/ }));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/auth/locale', { locale: 'en' }),
    );
    expect(useAuthStore.getState().user?.locale).toBe('en');
    // El título de la propia tarjeta acaba en inglés tras aplicar el idioma. Va en
    // `waitFor` porque desde la i18n perezosa el cambio en caliente **espera a un
    // `import()`**: el catálogo que no es el fuente llega por chunk, así que
    // asertar síncrono aquí es competir con esa promesa. Pasaba en CI por timing.
    await waitFor(() => expect(screen.getByText('Language')).toBeInTheDocument());
  });

  it('si el servidor falla, el idioma no cambia', async () => {
    apiMock.patch.mockRejectedValue(new Error('boom'));
    render(<LanguageCard />);
    await userEvent.click(screen.getByRole('button', { name: /English/ }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    expect(useAuthStore.getState().user?.locale).toBe('es');
  });

  it('renderiza en inglés cuando el idioma activo es en (locale forzado)', () => {
    setLocale('en', { persist: false });
    render(<LanguageCard />);
    expect(screen.getByText('Language')).toBeInTheDocument();
  });

  it('mientras guarda el foco se queda en el botón: no se deshabilita, se marca aria-disabled', async () => {
    // Un botón que pasa a `disabled` con el foco encima lo suelta y el foco acaba en <body>
    // (el siguiente Tab vuelve al principio de la página).
    let resolver!: (u: unknown) => void;
    apiMock.patch.mockReset().mockReturnValue(new Promise((r) => (resolver = r)));
    render(<LanguageCard />);
    const ingles = screen.getByRole('button', { name: /English/ });
    ingles.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(ingles).toHaveAttribute('aria-disabled', 'true'));
    expect(ingles).not.toBeDisabled();
    expect(ingles).toHaveFocus();
    // Y el segundo clic durante el guardado no manda otra petición.
    fireEvent.click(screen.getByRole('button', { name: /Español/ }));
    expect(apiMock.patch).toHaveBeenCalledTimes(1);
    resolver({ ...USER, locale: 'en' });
    await waitFor(() => expect(screen.getByText('Language')).toBeInTheDocument());
    await waitFor(() => expect(ingles).toHaveAttribute('aria-disabled', 'false'));
    expect(ingles).toHaveFocus();
  });
});
