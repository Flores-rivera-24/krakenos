import type { SystemSettingsResponse } from '@krakenos/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), patch: vi.fn(), post: vi.fn() };
});
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
    accessTokenTtl: '900',
    loginRateLimit: '5',
    theme: 'dark',
    homeLatitude: '',
    homeLongitude: '',
    presenceGraceMin: '10',
    presenceLeaveSweeps: '2',
    presenceNightSuppress: '',
    digestFrequency: 'off',
    autoBackupFrequency: 'off',
    autoBackupRetention: '7',
    updateMaintenanceWindow: '',
    telemetryEnabled: 'off',
  },
  info: { driver: 'mock', host: '192.168.1.1', httpsEnabled: false },
};

function setUser(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: {
      id: 'u',
      email: 'admin@krakenos.local',
      displayName: 'Emilio',
      role,
      createdAt: '',
      updatedAt: '',
    },
    tokens: { accessToken: 't', expiresIn: 900 },
  });
}

describe('SettingsPage', () => {
  beforeEach(() => {
    apiMock.get
      .mockReset()
      .mockImplementation((path: string) =>
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

  it('el menú de secciones se nombra y marca la sección actual con aria-current', async () => {
    setUser('admin');
    const user = userEvent.setup();
    render(<SettingsPage />);
    const menu = screen.getByRole('navigation', { name: 'Secciones de ajustes' });
    const botones = within(menu).getAllByRole('button');
    expect(botones.length).toBeGreaterThanOrEqual(5);
    // Una sola actual: Sistema al abrir…
    expect(within(menu).getByRole('button', { name: 'Sistema' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(botones.filter((b) => b.hasAttribute('aria-current'))).toHaveLength(1);
    // …y se mueve al pulsar otra.
    await user.click(within(menu).getByRole('button', { name: 'Cuenta' }));
    expect(within(menu).getByRole('button', { name: 'Cuenta' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(menu).getByRole('button', { name: 'Sistema' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('los tres «Guardar» de Sistema dicen qué guardan', async () => {
    setUser('admin');
    render(<SettingsPage />);
    await screen.findByLabelText('Supresión nocturna de salidas');
    for (const campo of [
      'Nombre del hogar',
      'Supresión nocturna de salidas',
      'Ventana de mantenimiento',
    ]) {
      expect(screen.getByRole('button', { name: `Guardar: ${campo}` })).toBeInTheDocument();
    }
    // Y ya no hay tres botones que se llamen igual.
    expect(screen.queryAllByRole('button', { name: 'Guardar' })).toHaveLength(0);
  });

  it('lo que significa dejar vacío un campo va en una ayuda visible, no en el placeholder', async () => {
    setUser('admin');
    render(<SettingsPage />);
    const noche = await screen.findByLabelText('Supresión nocturna de salidas');
    const ventana = screen.getByLabelText('Ventana de mantenimiento');
    // El placeholder es corto (en móvil se cortaba justo antes de decir qué pasa si está vacío)…
    expect(noche).toHaveAttribute('placeholder', 'p. ej. 23:00-07:00');
    expect(ventana).toHaveAttribute('placeholder', 'p. ej. 02:00-06:00');
    // …y el significado se lee bajo el campo y está enlazado a él.
    expect(noche).toHaveAccessibleDescription('Vacío = desactivada');
    expect(ventana).toHaveAccessibleDescription('Vacío = siempre');
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
    // El rol se enseña con su nombre («Observador»), no con el valor interno.
    expect(screen.getByText('Observador')).toBeInTheDocument();
    expect(screen.queryByText('viewer')).not.toBeInTheDocument();
  });

  it('la sección Cuenta nombra el rol admin como «Administrador»', async () => {
    setUser('admin');
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole('button', { name: 'Cuenta' }));
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(screen.queryByText('admin')).not.toBeInTheDocument();
  });

  it('el registro de auditoría enseña cada acción con su texto y declara la que no conoce', async () => {
    setUser('admin');
    const fila = (id: string, action: string, hora: string) => ({
      id,
      action,
      userId: null,
      detail: null,
      ip: null,
      createdAt: `2026-07-22T${hora}.000Z`,
    });
    apiMock.get.mockImplementation((path: string) => {
      if (path.startsWith('/system/settings')) return Promise.resolve(SETTINGS);
      if (path.startsWith('/audit'))
        return Promise.resolve([
          fila('a1', 'auth.login', '10:00:00'),
          fila('a2', 'device.block', '09:00:00'),
          fila('a3', 'zz.de-una-version-vieja', '08:00:00'),
        ]);
      return Promise.resolve([]);
    });
    const user = userEvent.setup();
    render(<SettingsPage />);
    await user.click(screen.getByRole('button', { name: 'Cuenta' }));

    expect(await screen.findByText('Inicio de sesión')).toBeInTheDocument();
    expect(screen.getByText('Dispositivo bloqueado')).toBeInTheDocument();
    // Una acción de una versión que esta web no conoce se declara, no se pinta cruda.
    expect(screen.getByText('Acción no reconocida (zz.de-una-version-vieja)')).toBeInTheDocument();
    expect(screen.queryByText('auth.login')).not.toBeInTheDocument();
  });

  // US-257: la §13 de la AGPL ofrece el código a quien **usa** el programa, no a
  // quien lo administra. Si «Acerca de» acabara detrás de `isAdmin` como sus
  // tarjetas vecinas, la instalación dejaría de cumplir su propia licencia para
  // todo el mundo menos el admin — y nadie lo notaría.
  it('la licencia y el enlace al código se ven sin ser admin', () => {
    setUser('viewer');
    render(<SettingsPage />);
    expect(screen.getByText(/AGPL-3\.0-or-later/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /código fuente/i })).toBeInTheDocument();
    // Contraste: lo que sí es admin-only sigue oculto para este mismo usuario.
    expect(screen.queryByText('Enviar feedback')).not.toBeInTheDocument();
  });
});
