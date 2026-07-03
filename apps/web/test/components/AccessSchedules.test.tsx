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

import { AccessSchedules } from '@/components/inventory/AccessSchedules';
import { useToastStore } from '@/store/toast.store';

const SCHEDULE = {
  id: 's1',
  name: 'Noche',
  mac: 'aa:bb',
  enabled: true,
  days: [1],
  startMinute: 21 * 60,
  endMinute: 7 * 60,
  createdAt: '',
};

describe('AccessSchedules — control parental (US-108)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue([]);
    apiMock.post.mockReset().mockResolvedValue({});
    apiMock.patch.mockReset().mockResolvedValue({});
    apiMock.del.mockReset().mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
  });

  it('muestra el vacío y crea un horario con la franja por defecto', async () => {
    const user = userEvent.setup();
    render(<AccessSchedules mac="aa:bb" canEdit />);
    await screen.findByText(/Sin horarios/);

    await user.click(screen.getByRole('button', { name: 'Añadir horario' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    const [url, body] = apiMock.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/access/schedules');
    expect(body).toMatchObject({ mac: 'aa:bb', startMinute: 1260, endMinute: 420 });
    expect(body.days).toEqual([1, 2, 3, 4, 5]);
  });

  it('lista un horario y permite borrarlo', async () => {
    apiMock.get.mockResolvedValue([SCHEDULE]);
    const user = userEvent.setup();
    render(<AccessSchedules mac="aa:bb" canEdit />);
    await screen.findByText('Noche');

    await user.click(screen.getByRole('button', { name: 'Borrar Noche' }));
    await waitFor(() => expect(apiMock.del).toHaveBeenCalledWith('/access/schedules/s1'));
  });

  it('un viewer no ve controles de edición', async () => {
    apiMock.get.mockResolvedValue([SCHEDULE]);
    render(<AccessSchedules mac="aa:bb" canEdit={false} />);
    await screen.findByText('Noche');
    expect(screen.queryByRole('button', { name: 'Añadir horario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Borrar/ })).not.toBeInTheDocument();
  });
});
