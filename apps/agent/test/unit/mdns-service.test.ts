import { describe, expect, it, vi } from 'vitest';
import { startMdnsResponder } from '../../src/discovery/mdns-service.js';
import type { ResponderSocket } from '../../src/discovery/mdns-responder.js';

function fakeSocket(startImpl: () => Promise<void> = async () => {}) {
  const socket: ResponderSocket = {
    start: vi.fn(startImpl),
    send: vi.fn(),
    close: vi.fn(async () => {}),
  };
  return socket;
}

function deps(socket: ResponderSocket, mode: 'auto' | 'on' | 'off', platform: NodeJS.Platform) {
  return {
    mode,
    platform,
    port: 3001,
    socket,
    nombre: ['mipc', 'krakenos'],
    interfaces: () => ({}),
    now: () => 0,
    log: { warn: vi.fn() },
  };
}

describe('startMdnsResponder', () => {
  it('auto en Linux: no abre el socket y el estado es off', async () => {
    const s = fakeSocket();
    const h = await startMdnsResponder(deps(s, 'auto', 'linux'));
    expect(s.start).not.toHaveBeenCalled();
    expect(h.status()).toEqual({ state: 'off', reason: null, address: null });
  });

  it('auto en Windows: arranca y se detiene en el cierre', async () => {
    const s = fakeSocket();
    const h = await startMdnsResponder(deps(s, 'auto', 'win32'));
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(h.status()).toEqual({ state: 'running', reason: null, address: 'mipc.local:3001' });
    await h.stop();
    expect(s.close).toHaveBeenCalledTimes(1);
  });

  it('off en Windows: no arranca', async () => {
    const s = fakeSocket();
    const h = await startMdnsResponder(deps(s, 'off', 'win32'));
    expect(s.start).not.toHaveBeenCalled();
    expect(h.status().state).toBe('off');
  });

  it('on en Linux: arranca', async () => {
    const s = fakeSocket();
    const h = await startMdnsResponder(deps(s, 'on', 'linux'));
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(h.status().state).toBe('running');
  });

  it('bind con EADDRINUSE: unavailable con motivo, no lanza y avisa UNA vez', async () => {
    const s = fakeSocket(async () => {
      throw Object.assign(new Error('bind EADDRINUSE 0.0.0.0:5353'), { code: 'EADDRINUSE' });
    });
    const d = deps(s, 'on', 'win32');
    const h = await startMdnsResponder(d);
    expect(h.status()).toEqual({
      state: 'unavailable',
      reason: 'bind EADDRINUSE 0.0.0.0:5353',
      address: null,
    });
    expect(d.log.warn).toHaveBeenCalledTimes(1);
    await h.stop(); // no cierra un socket que nunca abrió
    expect(s.close).not.toHaveBeenCalled();
    expect(h.status().state).toBe('unavailable');
    expect(d.log.warn).toHaveBeenCalledTimes(1);
  });
});
