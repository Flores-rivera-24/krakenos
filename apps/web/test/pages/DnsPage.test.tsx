import type { BlockedDomain, DnsQuery, DnsStats } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { DnsPage } from '@/pages/DnsPage';
import { useAuthStore } from '@/store/auth.store';

const STATS: DnsStats = {
  totalQueries: 1280,
  blockedQueries: 312,
  blockedPercent: 24,
  blocklistSize: 3,
};

const BLOCKED: BlockedDomain = {
  id: 'b1',
  domain: 'ads.doubleclick.net',
  createdAt: '2026-06-17T00:00:00.000Z',
};

const QUERY: DnsQuery = {
  timestamp: '2026-06-17T10:00:00.000Z',
  domain: 'github.com',
  client: '10.0.0.10',
  blocked: false,
};

function mockApi() {
  apiMock.get.mockImplementation((path: string) => {
    if (path === '/dns/stats') return Promise.resolve(STATS);
    if (path === '/dns/blocklist') return Promise.resolve([BLOCKED]);
    return Promise.resolve([QUERY]); // /dns/queries
  });
}

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'Emilio', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('DnsPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset().mockResolvedValue(BLOCKED);
    apiMock.del.mockReset().mockResolvedValue(undefined);
    mockApi();
    setRole('admin');
  });

  it('muestra estadísticas, blocklist y consultas recientes', async () => {
    render(<DnsPage />);
    await waitFor(() => expect(screen.getByText('24%')).toBeInTheDocument());
    expect(screen.getByText('ads.doubleclick.net')).toBeInTheDocument();
    expect(screen.getByText('github.com')).toBeInTheDocument();
    expect(screen.getByText('permitida')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/dns/queries?limit=20');
  });

  it('bloquea un dominio con el formulario (admin)', async () => {
    render(<DnsPage />);
    await screen.findByText('ads.doubleclick.net');

    await userEvent.type(screen.getByLabelText('Dominio'), 'tracker.nuevo.com');
    await userEvent.click(screen.getByRole('button', { name: /Bloquear/ }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/dns/blocklist', { domain: 'tracker.nuevo.com' }),
    );
  });

  it('un viewer no ve el formulario ni el botón de quitar', async () => {
    setRole('viewer');
    render(<DnsPage />);
    await screen.findByText('ads.doubleclick.net');
    expect(screen.queryByText('Bloquear dominio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  });
});
