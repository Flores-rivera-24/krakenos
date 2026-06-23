import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Socket falso con `connected`/`active` y registro de handlers para emitir eventos.
const fakeSocket = vi.hoisted(() => {
  const handlers: Record<string, () => void> = {};
  return {
    connected: false,
    active: true,
    on: vi.fn((ev: string, cb: () => void) => {
      handlers[ev] = cb;
    }),
    off: vi.fn(),
    io: { on: vi.fn(), off: vi.fn() },
    fire: (ev: string) => handlers[ev]?.(),
  };
});
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { useConnectionStore } from '@/store/connection.store';

describe('connection.store (US-94)', () => {
  beforeEach(() => {
    fakeSocket.connected = false;
    fakeSocket.active = true;
    useConnectionStore.setState({ status: 'connected' });
  });
  afterEach(() => {
    fakeSocket.connected = false;
    fakeSocket.active = true;
  });

  it('subscribe refleja "reconnecting" cuando el socket reintenta (no conectado, activo)', () => {
    const cleanup = useConnectionStore.getState().subscribe();
    expect(useConnectionStore.getState().status).toBe('reconnecting');
    cleanup();
  });

  it('refleja "offline" cuando el socket no reintentará (corte del servidor)', () => {
    fakeSocket.active = false;
    const cleanup = useConnectionStore.getState().subscribe();
    expect(useConnectionStore.getState().status).toBe('offline');
    cleanup();
  });

  it('pasa a "connected" al emitir el evento connect', () => {
    const cleanup = useConnectionStore.getState().subscribe();
    expect(useConnectionStore.getState().status).toBe('reconnecting');
    fakeSocket.connected = true;
    fakeSocket.fire('connect');
    expect(useConnectionStore.getState().status).toBe('connected');
    cleanup();
  });

  it('vuelve a "reconnecting" al perder la conexión (disconnect con socket activo)', () => {
    fakeSocket.connected = true;
    const cleanup = useConnectionStore.getState().subscribe();
    expect(useConnectionStore.getState().status).toBe('connected');
    fakeSocket.connected = false;
    fakeSocket.fire('disconnect');
    expect(useConnectionStore.getState().status).toBe('reconnecting');
    cleanup();
  });
});
