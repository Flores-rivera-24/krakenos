import type { AuthSession, SystemSettingKey } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { SecuritySection } from '@/components/settings/SecuritySection';
import { useAuthStore } from '@/store/auth.store';

const SESSIONS: AuthSession[] = [
  { id: 's1', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1e9).toISOString() },
  { id: 's2', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1e9).toISOString() },
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

function renderSection(isAdmin = true) {
  return render(
    <MemoryRouter>
      <SecuritySection settings={SETTINGS} patch={vi.fn()} isAdmin={isAdmin} />
    </MemoryRouter>,
  );
}

describe('SecuritySection', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(SESSIONS);
    apiMock.post.mockReset().mockResolvedValue(undefined);
    apiMock.del.mockReset().mockResolvedValue(undefined);
    useAuthStore.setState({
      user: { id: 'u', email: 'a@b.c', displayName: 'A', role: 'admin', createdAt: '', updatedAt: '' },
      tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
      logout: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('lista las sesiones activas y permite revocar una', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/auth/sessions'));
    const revokeButtons = await screen.findAllByRole('button', { name: 'Revocar' });
    expect(revokeButtons).toHaveLength(2);
    await user.click(revokeButtons[0]!);
    expect(apiMock.del).toHaveBeenCalledWith('/auth/sessions/s1');
  });

  it('"Cerrar todas las sesiones" envía el refresh token actual a conservar', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Cerrar todas las sesiones' }));
    expect(apiMock.del).toHaveBeenCalledWith('/auth/sessions', { body: { keepRefreshToken: 'r' } });
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
});
