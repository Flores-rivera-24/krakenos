import type { UpdatePlan } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class ApiRequestError extends Error {} }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/store/toast.store', () => ({ toast: toastMock }));

import { setLocale } from '@/lib/i18n';
import { UpdateCard } from '@/components/settings/UpdateCard';
import { useAuthStore } from '@/store/auth.store';

const basePlan: UpdatePlan = {
  enabled: true,
  current: '1.0.0',
  latest: '1.2.0',
  updateAvailable: true,
  mode: 'systemd',
  canSelfUpdate: true,
  dockerCommand: null,
  inProgress: false,
  maintenanceWindow: null,
  lastResult: null,
};

function setAdmin(role: 'admin' | 'viewer' = 'admin') {
  useAuthStore.setState({
    user: { id: 'u1', email: 'a@b.c', role, status: 'active', uiMode: 'advanced', locale: 'es' } as never,
  });
}

describe('UpdateCard — actualización one-click (US-116 / US-190)', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    setAdmin('admin');
  });
  afterEach(() => setLocale('es', { persist: false }));

  it('muestra la versión instalada y avisa de una actualización disponible', async () => {
    apiMock.get.mockResolvedValue(basePlan);
    render(<UpdateCard />);
    await screen.findByText('1.0.0');
    expect(await screen.findByText(/Actualización disponible/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2\.0/)).toBeInTheDocument();
  });

  it('el admin puede aplicar la actualización (systemd) y sale toast de inicio', async () => {
    apiMock.get.mockResolvedValue(basePlan);
    apiMock.post.mockResolvedValue({ started: true, mode: 'systemd', message: 'Actualizando…' });
    render(<UpdateCard />);
    const btn = await screen.findByRole('button', { name: /Actualizar ahora/ });
    fireEvent.click(btn);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/system/update/apply', {}));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it('un viewer no ve el botón de actualizar', async () => {
    setAdmin('viewer');
    apiMock.get.mockResolvedValue(basePlan);
    render(<UpdateCard />);
    await screen.findByText(/Actualización disponible/);
    expect(screen.queryByRole('button', { name: /Actualizar ahora/ })).not.toBeInTheDocument();
  });

  it('en Docker muestra el comando manual en vez del botón', async () => {
    apiMock.get.mockResolvedValue({
      ...basePlan,
      mode: 'docker',
      canSelfUpdate: false,
      dockerCommand: 'docker compose pull && docker compose up -d',
    });
    render(<UpdateCard />);
    expect(await screen.findByText(/docker compose pull/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actualizar ahora/ })).not.toBeInTheDocument();
  });

  it('indica que estás al día', async () => {
    apiMock.get.mockResolvedValue({ ...basePlan, latest: '1.0.0', updateAvailable: false });
    render(<UpdateCard />);
    expect(await screen.findByText(/Estás al día/)).toBeInTheDocument();
  });

  it('muestra desactivada cuando no hay repo configurado', async () => {
    apiMock.get.mockResolvedValue({ ...basePlan, enabled: false, updateAvailable: false, latest: null });
    render(<UpdateCard />);
    expect(await screen.findByText(/desactivada/)).toBeInTheDocument();
  });

  it('muestra el resultado revertido de la última actualización', async () => {
    apiMock.get.mockResolvedValue({
      ...basePlan,
      updateAvailable: false,
      latest: '1.0.0',
      lastResult: {
        ok: false,
        rolledBack: true,
        fromVersion: '1.0.0',
        targetVersion: '1.2.0',
        steps: [],
        finishedAt: '2026-07-13T10:00:00.000Z',
      },
    });
    render(<UpdateCard />);
    expect(await screen.findByText(/revertida a 1\.0\.0/)).toBeInTheDocument();
  });
});
