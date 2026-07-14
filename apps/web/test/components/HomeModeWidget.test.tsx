import type { PresenceEvent, PresenceState } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));
const fakeSocket = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn() }));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { HomeModeWidget } from '@/components/dashboard/widgets/HomeModeWidget';
import { useAuthStore } from '@/store/auth.store';

const STATE: PresenceState = {
  mode: 'home',
  modeSource: 'manual',
  modeChangedAt: null,
  people: [
    { userId: 'u1', displayName: 'Ana', home: true, since: null, deviceCount: 1 },
    { userId: 'u2', displayName: 'Bob', home: false, since: null, deviceCount: 2 },
  ],
};

const TIMELINE: PresenceEvent[] = [
  { id: 'e1', userId: 'u1', displayName: 'Ana', kind: 'arrived', at: new Date().toISOString() },
];

function setRole(role: 'admin' | 'member' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('HomeModeWidget (US-169)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/presence') return Promise.resolve(STATE);
      if (path.startsWith('/presence/timeline')) return Promise.resolve(TIMELINE);
      return Promise.resolve([]);
    });
    apiMock.post.mockReset().mockResolvedValue({ ...STATE, mode: 'night' });
    setRole('admin');
  });

  it('pinta el modo actual, las personas y el timeline', async () => {
    render(<HomeModeWidget />);
    const homeBtn = await screen.findByRole('button', { name: /En casa/ });
    expect(homeBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText(/Ana llegó/)).toBeInTheDocument();
    // US-212: nota honesta sobre el límite físico de la presencia por WiFi.
    expect(screen.getByText(/reposo profundo/)).toBeInTheDocument();
  });

  it('cambiar de modo llama a POST /presence/mode y refleja la respuesta', async () => {
    render(<HomeModeWidget />);
    await screen.findByRole('button', { name: /En casa/ });
    await userEvent.click(screen.getByRole('button', { name: /Noche/ }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/presence/mode', { mode: 'night' }),
    );
    expect(screen.getByRole('button', { name: /Noche/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('un viewer ve el estado pero no puede cambiar el modo (gate cosmético)', async () => {
    setRole('viewer');
    render(<HomeModeWidget />);
    const btn = await screen.findByRole('button', { name: /Fuera/ });
    expect(btn).toBeDisabled();
  });

  it('se suscribe a presence:updated y re-consulta al recibirlo', async () => {
    render(<HomeModeWidget />);
    await screen.findByRole('button', { name: /En casa/ });
    expect(fakeSocket.on).toHaveBeenCalledWith('presence:updated', expect.any(Function));
    const handler = fakeSocket.on.mock.calls.find((c) => c[0] === 'presence:updated')?.[1] as () => void;
    apiMock.get.mockClear();
    handler();
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/presence'));
  });
});
