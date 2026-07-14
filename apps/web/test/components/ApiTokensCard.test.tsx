import type { ApiTokenInfo } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tokensMock = vi.hoisted(() => ({
  listApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
}));
vi.mock('@/lib/tokens', () => tokensMock);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/store/toast.store', () => ({ toast: toastMock }));

import { setLocale } from '@/lib/i18n';
import { ApiTokensCard } from '@/components/settings/ApiTokensCard';
import { useAuthStore } from '@/store/auth.store';

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', role, status: 'active', uiMode: 'advanced', locale: 'es' } as never,
  });
}

const existing: ApiTokenInfo = {
  id: 't1',
  name: 'HA',
  prefix: 'krt_ab12',
  scopes: ['home.view'],
  role: 'admin',
  lastUsedAt: null,
  expiresAt: null,
  createdAt: '2026-07-13T10:00:00.000Z',
};

describe('ApiTokensCard (US-174)', () => {
  beforeEach(() => {
    tokensMock.listApiTokens.mockReset().mockResolvedValue([existing]);
    tokensMock.createApiToken.mockReset();
    tokensMock.revokeApiToken.mockReset().mockResolvedValue(undefined);
    toastMock.error.mockReset();
    setRole('admin');
  });
  afterEach(() => setLocale('es', { persist: false }));

  it('lista los tokens existentes', async () => {
    render(<ApiTokensCard />);
    expect(await screen.findByText('HA')).toBeInTheDocument();
  });

  it('crea un token y muestra el valor en claro una vez', async () => {
    tokensMock.createApiToken.mockResolvedValue({ ...existing, id: 't2', name: 'Nuevo', token: 'krt_SECRETO' });
    render(<ApiTokensCard />);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nuevo' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear token/ }));
    await waitFor(() => expect(tokensMock.createApiToken).toHaveBeenCalled());
    expect(await screen.findByText('krt_SECRETO')).toBeInTheDocument();
    expect(screen.getByText(/No se volverá a mostrar/)).toBeInTheDocument();
  });

  it('un viewer no ve la opción de controlar dispositivos', async () => {
    setRole('viewer');
    render(<ApiTokensCard />);
    await screen.findByText('HA');
    expect(screen.queryByText('Controlar dispositivos')).not.toBeInTheDocument();
  });

  it('revoca un token', async () => {
    render(<ApiTokensCard />);
    await screen.findByText('HA');
    fireEvent.click(screen.getByRole('button', { name: 'Revocar' }));
    await waitFor(() => expect(tokensMock.revokeApiToken).toHaveBeenCalledWith('t1'));
  });
});
