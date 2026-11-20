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
    every: () => () => {},
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
    expect(h.status()).toEqual({ state: 'off', reason: null, code: null, address: null });
  });

  it('auto en Windows: arranca y se detiene en el cierre', async () => {
    const s = fakeSocket();
    const h = await startMdnsResponder(deps(s, 'auto', 'win32'));
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(h.status()).toEqual({
      state: 'running',
      reason: null,
      code: null,
      address: 'mipc.local:3001',
    });
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
      code: 'EADDRINUSE',
      address: null,
    });
    expect(d.log.warn).toHaveBeenCalledTimes(1);
    await h.stop(); // no cierra un socket que nunca abrió
    expect(s.close).not.toHaveBeenCalled();
    expect(h.status().state).toBe('unavailable');
    expect(d.log.warn).toHaveBeenCalledTimes(1);
  });

  it('nombre como string: la dirección usa ese nombre', async () => {
    const h = await startMdnsResponder({ ...deps(fakeSocket(), 'on', 'linux'), nombre: 'solo' });
    expect(h.status().address).toBe('solo.local:3001');
  });
});

describe('seguimiento de la red', () => {
  function setup(startImpl?: () => Promise<void>) {
    let ips: string[] = ['192.168.1.10'];
    let tick: () => void | Promise<void> = () => {};
    const cancel = vi.fn();
    const s = fakeSocket(startImpl);
    s.refresh = vi.fn();
    const d = {
      ...deps(s, 'on', 'win32'),
      interfaces: () => ({
        eth0: ips.map((address) => ({
          address,
          family: 'IPv4' as const,
          internal: false,
          netmask: '255.255.255.0',
          cidr: `${address}/24`,
          mac: '',
        })),
      }),
      every: (fn: () => void | Promise<void>) => {
        tick = fn;
        return cancel;
      },
    };
    return {
      s,
      d,
      cancel,
      setIps: (v: string[]) => (ips = v),
      tick: () => tick(),
    };
  }

  it('una red nueva vuelve a unir el grupo, avisa una vez y sin cambios no hace nada', async () => {
    const t = setup();
    await startMdnsResponder(t.d);
    await t.tick();
    expect(t.s.refresh).not.toHaveBeenCalled();
    t.setIps(['192.168.1.10', '10.0.0.5']);
    await t.tick();
    await t.tick();
    expect(t.s.refresh).toHaveBeenCalledTimes(1);
    expect(t.d.log.warn).toHaveBeenCalledTimes(1);
  });

  it('arrancó sin red: unavailable, y cuando aparece la red reintenta y pasa a running', async () => {
    let fail = true;
    const t = setup(async () => {
      if (fail) throw new Error('no network');
    });
    const h = await startMdnsResponder(t.d);
    expect(h.status().state).toBe('unavailable');
    fail = false;
    await t.tick();
    expect(h.status()).toMatchObject({ state: 'running', address: 'mipc.local:3001' });
  });

  it('un error del socket tras el bind deja unavailable (no running) y se recupera', async () => {
    let onErr: (e: Error) => void = () => {};
    const t = setup();
    (t.s.start as ReturnType<typeof vi.fn>).mockImplementation(async (_cb, e) => {
      onErr = e;
    });
    const h = await startMdnsResponder(t.d);
    expect(h.status().state).toBe('running');
    onErr(new Error('ENETDOWN'));
    expect(h.status()).toMatchObject({ state: 'unavailable', code: 'other' });
    await t.tick();
    expect(h.status().state).toBe('running');
    expect(t.s.close).toHaveBeenCalledTimes(1);
  });

  it('stop cancela el temporizador', async () => {
    const t = setup();
    const h = await startMdnsResponder(t.d);
    await h.stop();
    expect(t.cancel).toHaveBeenCalledTimes(1);
  });
});
