import type { SystemSettingsResponse } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { SettingsPage } from '@/pages/SettingsPage';
import { useAuthStore } from '@/store/auth.store';

const SETTINGS: SystemSettingsResponse = {
  settings: {
    homeName: 'Casa Flores',
    timezone: 'Europe/Madrid',
    scanIntervalSec: '60',
    trafficRetentionDays: '7',
    auditRetentionDays: '90',
  },
  info: { driver: 'mock', host: '192.168.1.1', httpsEnabled: false },
};

function setUser(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'admin@krakenos.local', displayName: 'Emilio', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('SettingsPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) =>
      path.startsWith('/system/settings') ? Promise.resolve(SETTINGS) : Promise.resolve([]),
    );
    apiMock.patch.mockReset().mockResolvedValue(SETTINGS);
    apiMock.post.mockReset().mockResolvedValue({ ok: true, latencyMs: 3 });
  });

  it('renderiza las 5 secciones', () => {
    setUser('admin');
    render(<SettingsPage />);
    for (const s of ['Sistema', 'Red', 'Seguridad', 'Integraciones', 'Cuenta']) {
      expect(screen.getByRole('button', { name: s })).toBeInTheDocument();
    }
  });

  it('carga los ajustes del sistema y muestra el estado de HTTPS', async () => {
    setUser('admin');
    render(<SettingsPage />);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/system/settings'));
    expect(await screen.findByDisplayValue('Casa Flores')).toBeInTheDocument();
    expect(screen.getByText(/Desactivado/)).toBeInTheDocument();
  });

  it('un admin puede cambiar la zona horaria: PATCH con la clave', async () => {
    setUser('admin');
    const user = userEvent.setup();
    render(<SettingsPage />);
    await screen.findByDisplayValue('Casa Flores');
    await user.selectOptions(screen.getByDisplayValue('Europe/Madrid'), 'UTC');
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/system/settings', {
        key: 'timezone',
        value: 'UTC',
      }),
    );
  });

  it('muestra un error y no falla en silencio si el PATCH falla (US-55)', async () => {
    setUser('admin');
    apiMock.patch.mockRejectedValue(new Error('500'));
    const user = userEvent.setup();
    render(<SettingsPage />);
    await screen.findByDisplayValue('Casa Flores');

    await user.selectOptions(screen.getByDisplayValue('Europe/Madrid'), 'UTC');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no se pudo guardar/i);
    // Reversión visual: el select vuelve a mostrar el valor guardado.
    expect(screen.getByDisplayValue('Europe/Madrid')).toBeInTheDocument();
  });

  it('la sección Red prueba la conexión vía connectivity-test', async () => {
    setUser('admin');
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole('button', { name: 'Red' }));
    await user.click(screen.getByRole('button', { name: 'Probar conexión' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/system/connectivity-test'));
    expect(await screen.findByText(/OK · 3 ms/)).toBeInTheDocument();
  });

  it('la sección Cuenta muestra los datos del usuario', async () => {
    setUser('viewer');
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole('button', { name: 'Cuenta' }));
    expect(screen.getByText('Emilio')).toBeInTheDocument();
    expect(screen.getByText('admin@krakenos.local')).toBeInTheDocument();
  });
});
