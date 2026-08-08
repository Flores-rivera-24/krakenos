import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { DnsFeeds } from '@/components/dns/DnsFeeds';
import { useToastStore } from '@/store/toast.store';

const FEEDS = [
  { id: 'ads', name: 'Publicidad', description: 'Bloquea anuncios', url: 'http://x', enabled: false },
];

describe('DnsFeeds — feeds de categoría (US-114)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(FEEDS);
    apiMock.patch.mockReset().mockResolvedValue({ ...FEEDS[0], enabled: true });
    useToastStore.setState({ toasts: [] });
  });

  it('lista y activa un feed (admin)', async () => {
    const user = userEvent.setup();
    render(<DnsFeeds canEdit />);
    await screen.findByText('Publicidad');

    await user.click(screen.getByRole('switch', { name: 'Activar Publicidad' }));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/dns/feeds/ads', { enabled: true }),
    );
  });

  it('un viewer no puede togglear (switch deshabilitado)', async () => {
    render(<DnsFeeds canEdit={false} />);
    await screen.findByText('Publicidad');
    expect(screen.getByRole('switch', { name: 'Activar Publicidad' })).toBeDisabled();
  });
});
