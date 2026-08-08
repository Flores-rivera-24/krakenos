import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class ApiRequestError extends Error {} }));

import { AlertRulesCard } from '@/components/settings/AlertRulesCard';
import { ensureCatalog, setLocale } from '@/lib/i18n';
import { useToastStore } from '@/store/toast.store';

const RULES = [
  { event: 'device.block', push: true, email: false, telegram: false },
  { event: 'auth.login_failed', push: true, email: false, telegram: false },
];

describe('AlertRulesCard — reglas de alerta (US-112)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(RULES);
    apiMock.patch.mockReset().mockResolvedValue({ ...RULES[0], email: true });
    useToastStore.setState({ toasts: [] });
  });

  it('lista las reglas y activa el email de un evento', async () => {
    const user = userEvent.setup();
    render(<AlertRulesCard />);
    await screen.findByText('Dispositivo bloqueado');

    await user.click(screen.getByRole('switch', { name: 'Email: Dispositivo bloqueado' }));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/alerts/rules/device.block', { email: true }),
    );
  });

  it('activa el canal Telegram de un evento (US-180)', async () => {
    const user = userEvent.setup();
    render(<AlertRulesCard />);
    await screen.findByText('Login fallido');

    await user.click(screen.getByRole('switch', { name: 'Telegram: Login fallido' }));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/alerts/rules/auth.login_failed', {
        telegram: true,
      }),
    );
  });
});

/**
 * Las etiquetas de evento en inglés (US-270).
 *
 * Vivían en el AGENTE (`alerts/alert-config.ts`), que no tiene i18n, y viajaban
 * dentro de la respuesta de la API: con la app en inglés, las trece filas y sus
 * `aria-label` salían en español. Ahora la API manda **la clave** y el copy lo
 * pone la web, que es quien sabe en qué idioma está el usuario.
 */
describe('AlertRulesCard en inglés', () => {
  beforeAll(() => ensureCatalog('en'));
  afterEach(() => setLocale('es', { persist: false }));
  // Este `describe` es hermano del de arriba, así que NO hereda su `beforeEach`:
  // sin esto el mock no devuelve nada y el fallo no se parece a su causa.
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(RULES);
    apiMock.patch.mockReset();
  });

  it('traduce las etiquetas de evento y sus aria-label', async () => {
    setLocale('en', { persist: false });
    render(<AlertRulesCard />);

    expect(await screen.findByText('Device blocked')).toBeInTheDocument();
    expect(screen.getByText('Failed login')).toBeInTheDocument();
    expect(screen.queryByText('Dispositivo bloqueado')).toBeNull();
    // El nombre accesible es copy de primera: si se queda en español, quien usa
    // lector de pantalla oye otra cosa que quien mira.
    expect(screen.getByRole('switch', { name: 'Push: Device blocked' })).toBeInTheDocument();
  });

  it('un evento que esta versión no conoce se declara, no se enseña crudo', async () => {
    setLocale('en', { persist: false });
    apiMock.get.mockResolvedValueOnce([
      { event: 'alarm.something_new', push: true, email: false, telegram: false },
    ]);
    render(<AlertRulesCard />);
    // `event` llega del servidor: un agente más nuevo puede anunciar eventos que
    // este catálogo no tiene, y enseñar `alarm.something_new` en una tabla de
    // ajustes es peor que decir que no se reconoce.
    expect(await screen.findByText('Event not recognised by this version')).toBeInTheDocument();
    expect(screen.queryByText('alarm.something_new')).toBeNull();
  });
});
