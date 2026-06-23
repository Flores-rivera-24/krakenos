import type { FirewallRule } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { FirewallPage } from '@/pages/FirewallPage';
import { useAuthStore } from '@/store/auth.store';

const RULE: FirewallRule = {
  id: 'r1',
  name: 'Bloquear IoT',
  action: 'deny',
  protocol: 'any',
  source: '10.0.30.0/24',
  destination: null,
  port: null,
  enabled: true,
  priority: 0,
  createdAt: '2026-06-17T00:00:00.000Z',
};

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'Emilio', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('FirewallPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue([RULE]);
    apiMock.post.mockReset().mockResolvedValue(RULE);
    apiMock.patch.mockReset().mockResolvedValue({ ...RULE, enabled: false });
    apiMock.del.mockReset().mockResolvedValue(undefined);
    setRole('admin');
  });

  it('carga y muestra las reglas existentes', async () => {
    render(<FirewallPage />);
    await waitFor(() => expect(screen.getByText('Bloquear IoT')).toBeInTheDocument());
    expect(screen.getByText('10.0.30.0/24')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/firewall/rules');
  });

  it('crea una regla con el formulario (admin)', async () => {
    render(<FirewallPage />);
    await screen.findByText('Bloquear IoT');

    await userEvent.type(screen.getByLabelText('Nombre'), 'Nueva regla');
    await userEvent.click(screen.getByRole('button', { name: /Añadir regla/ }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/firewall/rules',
        expect.objectContaining({ name: 'Nueva regla', action: 'deny', protocol: 'any' }),
      ),
    );
  });

  it('alterna el estado de una regla con el switch', async () => {
    render(<FirewallPage />);
    await screen.findByText('Bloquear IoT');

    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/firewall/rules/r1', { enabled: false }),
    );
  });

  it('un viewer no ve el formulario de creación', async () => {
    setRole('viewer');
    render(<FirewallPage />);
    await screen.findByText('Bloquear IoT');
    expect(screen.queryByText('Nueva regla')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Añadir regla/ })).not.toBeInTheDocument();
  });

  it('muestra un banner role="alert" si la carga falla (US-93)', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('boom'));
    render(<FirewallPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar con el servidor/);
  });

  it('muestra el estado vacío honesto sin reglas (US-93)', async () => {
    apiMock.get.mockReset().mockResolvedValue([]);
    render(<FirewallPage />);
    expect(await screen.findByText(/Aún no hay reglas configuradas/)).toBeInTheDocument();
  });
});
