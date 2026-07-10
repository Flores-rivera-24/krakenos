import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), del: vi.fn() }));
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
    expect(screen.getByRole('button', { name: /English/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('cambiar de idioma llama al PATCH de autoservicio, actualiza el store y aplica el idioma', async () => {
    render(<LanguageCard />);
    await userEvent.click(screen.getByRole('button', { name: /English/ }));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/auth/locale', { locale: 'en' }),
    );
    expect(useAuthStore.getState().user?.locale).toBe('en');
    // El título de la propia tarjeta ya está en inglés tras aplicar el idioma.
    expect(screen.getByText('Language')).toBeInTheDocument();
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
});
