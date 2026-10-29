import type { PresenceEvent, PresenceState } from '@krakenos/types';
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
    patch: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  };
});
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
    { userId: 'u1', displayName: 'Ana', home: true, since: null, deviceCount: 1, signal: 'stale' },
    { userId: 'u2', displayName: 'Bob', home: false, since: null, deviceCount: 2, signal: 'fresh' },
  ],
};

const TIMELINE: PresenceEvent[] = [
  { id: 'e1', userId: 'u1', displayName: 'Ana', kind: 'arrived', at: new Date().toISOString() },
];

function setRole(role: 'admin' | 'member' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', expiresIn: 900 },
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
    // US-220: señal débil visible en la persona con salida pendiente (Ana, stale).
    expect(screen.getByText(/señal débil/)).toBeInTheDocument();
  });

  it('los modos y la línea de tiempo usan svg ocultos, sin emoji', async () => {
    render(<HomeModeWidget />);
    const homeBtn = await screen.findByRole('button', { name: /En casa/ });
    expect(homeBtn.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(homeBtn.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    const fila = screen.getByText(/Ana llegó/).closest('li') as HTMLElement;
    expect(fila.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(fila.textContent).not.toMatch(/\p{Extended_Pictographic}|→/u);
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
    const handler = fakeSocket.on.mock.calls.find(
      (c) => c[0] === 'presence:updated',
    )?.[1] as () => void;
    apiMock.get.mockClear();
    handler();
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/presence'));
  });

  describe('fallos de carga', () => {
    it('sin estado de presencia no inventa un modo: lo dice y deja reintentar', async () => {
      apiMock.get.mockReset().mockImplementation((path: string) => {
        if (path === '/presence') return Promise.reject(new Error('caído'));
        return Promise.resolve(TIMELINE);
      });
      render(<HomeModeWidget />);
      expect(await screen.findByText('No se pudo cargar el estado del hogar.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /En casa/ })).not.toBeInTheDocument();
      apiMock.get
        .mockReset()
        .mockImplementation((path: string) =>
          path === '/presence' ? Promise.resolve(STATE) : Promise.resolve(TIMELINE),
        );
      await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
      expect(await screen.findByRole('button', { name: /En casa/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('si solo falla el timeline, el modo se pinta y el timeline caído se dice aparte', async () => {
      apiMock.get
        .mockReset()
        .mockImplementation((path: string) =>
          path === '/presence' ? Promise.resolve(STATE) : Promise.reject(new Error('caído')),
        );
      render(<HomeModeWidget />);
      expect(await screen.findByRole('button', { name: /En casa/ })).toBeInTheDocument();
      expect(
        await screen.findByText('No se pudo cargar la actividad reciente de presencia.'),
      ).toBeInTheDocument();
    });

    it('timeline que falla con timeline previo: se conserva y se marca como obsoleto', async () => {
      render(<HomeModeWidget />);
      await screen.findByText(/Ana llegó/);
      const handler = fakeSocket.on.mock.calls
        .filter((c) => c[0] === 'presence:updated')
        .at(-1)?.[1] as () => void;
      apiMock.get
        .mockReset()
        .mockImplementation((path: string) =>
          path === '/presence' ? Promise.resolve(STATE) : Promise.reject(new Error('caído')),
        );
      handler();
      await waitFor(() => expect(screen.getAllByText('Datos obsoletos')).toHaveLength(1));
      expect(screen.getByText(/Ana llegó/)).toBeInTheDocument();
    });

    it('un re-sondeo que falla conserva el estado y lo marca como obsoleto', async () => {
      render(<HomeModeWidget />);
      await screen.findByRole('button', { name: /En casa/ });
      const handler = fakeSocket.on.mock.calls
        .filter((c) => c[0] === 'presence:updated')
        .at(-1)?.[1] as () => void;
      apiMock.get.mockReset().mockRejectedValue(new Error('caído'));
      handler();
      expect(await screen.findByText('Datos obsoletos')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /En casa/ })).toBeInTheDocument();
    });
  });
});
