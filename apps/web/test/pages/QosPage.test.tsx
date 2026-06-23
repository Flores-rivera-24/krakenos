import type { QosRule } from '@krakenos/types';
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

import { QosPage } from '@/pages/QosPage';
import { useAuthStore } from '@/store/auth.store';

const RULE: QosRule = {
  id: 'q1',
  name: 'Limitar consola',
  priority: 'low',
  target: '10.0.0.50',
  downloadKbps: 20_000,
  uploadKbps: 5_000,
  enabled: true,
  createdAt: '2026-06-17T00:00:00.000Z',
};

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'Emilio', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('QosPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue([RULE]);
    apiMock.post.mockReset().mockResolvedValue(RULE);
    apiMock.patch.mockReset().mockResolvedValue({ ...RULE, enabled: false });
    apiMock.del.mockReset().mockResolvedValue(undefined);
    setRole('admin');
  });

  it('muestra las reglas con prioridad y límite legible', async () => {
    render(<QosPage />);
    await waitFor(() => expect(screen.getByText('Limitar consola')).toBeInTheDocument());
    expect(screen.getByText('10.0.0.50')).toBeInTheDocument();
    expect(screen.getByText('20 Mbps')).toBeInTheDocument(); // 20000 kbps
    expect(apiMock.get).toHaveBeenCalledWith('/qos/rules');
  });

  it('crea una regla con el formulario (admin)', async () => {
    render(<QosPage />);
    await screen.findByText('Limitar consola');

    await userEvent.type(screen.getByLabelText('Nombre'), 'Prioridad trabajo');
    await userEvent.type(screen.getByLabelText('Objetivo'), '10.0.0.20');
    await userEvent.click(screen.getByRole('button', { name: /Añadir regla/ }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/qos/rules',
        expect.objectContaining({ name: 'Prioridad trabajo', target: '10.0.0.20', priority: 'normal' }),
      ),
    );
  });

  it('alterna el estado de una regla con el switch', async () => {
    render(<QosPage />);
    await screen.findByText('Limitar consola');

    await userEvent.click(screen.getByRole('switch'));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/qos/rules/q1', { enabled: false }),
    );
  });

  it('un viewer no ve el formulario de creación', async () => {
    setRole('viewer');
    render(<QosPage />);
    await screen.findByText('Limitar consola');
    expect(screen.queryByText('Nueva regla')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Añadir regla/ })).not.toBeInTheDocument();
  });

  it('muestra un banner role="alert" si la carga falla (US-93)', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('boom'));
    render(<QosPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar con el servidor/);
  });

  it('muestra el estado vacío honesto sin reglas (US-93)', async () => {
    apiMock.get.mockReset().mockResolvedValue([]);
    render(<QosPage />);
    expect(await screen.findByText(/Aún no hay reglas de QoS/)).toBeInTheDocument();
  });
});
