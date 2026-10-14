import { beforeEach, describe, expect, it, vi } from 'vitest';

// Socket.io falso: registra el orden de las llamadas para comprobar que lo
// encolado se aplica ANTES de conectar.
const calls = vi.hoisted(() => ({ log: [] as string[], connected: false, loads: 0 }));
const fakeClient = vi.hoisted(() => () => ({
  io: () => ({
    on: (ev: string) => calls.log.push(`on:${ev}`),
    off: (ev: string) => calls.log.push(`off:${ev}`),
    emit: (ev: string) => calls.log.push(`emit:${ev}`),
    connect: () => calls.log.push('connect'),
    io: { on: (ev: string) => calls.log.push(`io.on:${ev}`), off: vi.fn() },
    get connected() {
      return calls.connected;
    },
    active: true,
  }),
}));
vi.mock('@/lib/socket-client', fakeClient);

describe('getSocket (fachada perezosa)', () => {
  beforeEach(() => {
    calls.log.length = 0;
    calls.connected = false;
    calls.loads = 0;
    vi.resetModules();
  });

  it('es singleton y, antes de cargar la librería, declara «conectando»', async () => {
    const { getSocket } = await import('@/lib/socket');
    const s = getSocket();
    expect(getSocket()).toBe(s);
    expect(s.connected).toBe(false);
    expect(s.active).toBe(true);
  });

  it('encola on/emit/io.on y los aplica en orden sobre el socket real ANTES de conectar', async () => {
    const { getSocket } = await import('@/lib/socket');
    const s = getSocket();
    s.on('inventory:snapshot', () => {});
    s.io.on('reconnect', () => {});
    s.emit('inventory:rescan');
    await vi.waitFor(() => expect(calls.log).toContain('connect'));
    const i = (x: string) => calls.log.indexOf(x);
    expect(i('on:inventory:snapshot')).toBeGreaterThanOrEqual(0);
    expect(i('on:inventory:snapshot')).toBeLessThan(i('io.on:reconnect'));
    expect(i('io.on:reconnect')).toBeLessThan(i('emit:inventory:rescan'));
    expect(i('emit:inventory:rescan')).toBeLessThan(i('connect'));
  });

  it('tras cargar, delega en el socket real y refleja su estado', async () => {
    const { getSocket } = await import('@/lib/socket');
    const s = getSocket();
    await vi.waitFor(() => expect(calls.log).toContain('connect'));
    calls.log.length = 0;
    calls.connected = true;
    s.off('connect', () => {});
    expect(calls.log).toEqual(['off:connect']);
    expect(s.connected).toBe(true);
  });

  it('si el chunk no llega, reintenta con backoff conservando la cola y conecta UNA vez', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.doMock('@/lib/socket-client', () => {
        calls.loads += 1;
        if (calls.loads <= 2) throw new Error('Failed to fetch dynamically imported module');
        return fakeClient();
      });
      const { getSocket } = await import('@/lib/socket');
      const s = getSocket();
      s.on('inventory:snapshot', () => {});
      s.on('iot:snapshot', () => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(s.connected).toBe(false);
      expect(calls.log).toEqual([]);
      await vi.advanceTimersByTimeAsync(1000); // 2.º intento: falla, siguiente espera 2 s
      expect(warn).toHaveBeenCalledTimes(2);
      expect(calls.log).toEqual([]);
      await vi.advanceTimersByTimeAsync(2000); // 3.º: funciona
      expect(calls.log.filter((x) => !/^on:(connect|connect_error|auth:expired)$/.test(x))).toEqual(
        ['on:inventory:snapshot', 'on:iot:snapshot', 'connect'],
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls.log.filter((x) => x === 'connect')).toHaveLength(1);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
