import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class ApiRequestError extends Error {} }));

import { AlertRulesCard } from '@/components/settings/AlertRulesCard';
import { useToastStore } from '@/store/toast.store';

const RULES = [
  { event: 'device.block', label: 'Dispositivo bloqueado', push: true, email: false, telegram: false },
  { event: 'auth.login_failed', label: 'Login fallido', push: true, email: false, telegram: false },
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
