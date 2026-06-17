import type { AuditLogEntry } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { SettingsPage } from '@/pages/SettingsPage';
import { useAuthStore } from '@/store/auth.store';

function setUser(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'admin@krakenos.local', displayName: 'Emilio', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

const AUDIT: AuditLogEntry[] = [
  { id: 'a1', action: 'auth.login', userId: 'u', detail: null, ip: '192.168.1.5', createdAt: new Date().toISOString() },
];

describe('SettingsPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(AUDIT);
  });

  it('muestra los datos de la cuenta', () => {
    setUser('viewer');
    render(<SettingsPage />);
    expect(screen.getByText('Emilio')).toBeInTheDocument();
    expect(screen.getByText('admin@krakenos.local')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
  });

  it('un viewer no ve el registro de auditoría ni lo solicita', () => {
    setUser('viewer');
    render(<SettingsPage />);
    expect(screen.queryByText('Registro de auditoría')).not.toBeInTheDocument();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('un admin carga y muestra el registro de auditoría', async () => {
    setUser('admin');
    render(<SettingsPage />);
    expect(screen.getByText('Registro de auditoría')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Inicio de sesión')).toBeInTheDocument());
    expect(screen.getByText('192.168.1.5')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/audit?limit=50');
  });

  it('un admin sin actividad ve el estado vacío', async () => {
    setUser('admin');
    apiMock.get.mockResolvedValue([]);
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByText('Sin actividad registrada.')).toBeInTheDocument());
  });
});
