import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResponderSocket } from '../../src/discovery/mdns-responder.js';
import { buildServer } from '../../src/server.js';

const tokenTemporal = (): string =>
  join(mkdtempSync(join(tmpdir(), 'krakenos-setup-')), 'setup-token');

const NICS = {
  eth0: [
    {
      address: '192.168.1.10',
      netmask: '255.255.255.0',
      family: 'IPv4' as const,
      mac: '00:00:00:00:00:00',
      internal: false,
      cidr: '192.168.1.10/24',
    },
  ],
};

/** Pregunta A por `name` (clase IN, desde el puerto 5353 = mDNS normal). */
function queryA(name: string): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);
  const labels = name
    .split('.')
    .map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(1, 0);
  tail.writeUInt16BE(0x8001, 2); // QU: responde a quien pregunta (sin el límite del grupo)
  return Buffer.concat([header, ...labels, Buffer.from([0]), tail]);
}

function fakeSocket() {
  let onMessage: ((m: Buffer, f: { address: string; port: number }) => void) | null = null;
  const socket: ResponderSocket = {
    start: vi.fn(async (cb) => {
      onMessage = cb;
    }),
    send: vi.fn(),
    close: vi.fn(async () => {}),
  };
  let n = 50;
  const ask = (name: string) => {
    onMessage?.(queryA(name), { address: `192.168.1.${n++}`, port: 5353 });
    return vi.mocked(socket.send).mock.calls.length;
  };
  return { socket, ask };
}

describe('buildServer: respondedor mDNS (US-283)', () => {
  const prev = process.env.KRAKENOS_HOSTNAME;
  afterEach(() => {
    if (prev === undefined) delete process.env.KRAKENOS_HOSTNAME;
    else process.env.KRAKENOS_HOSTNAME = prev;
  });

  it('con modo on arranca con [nombre saneado, krakenos] y app.close() lo para', async () => {
    process.env.KRAKENOS_HOSTNAME = 'Mi_PC-1';
    const { socket, ask } = fakeSocket();
    const app = await buildServer({
      setupTokenFile: tokenTemporal(),
      mdns: { mode: 'on', socket, interfaces: () => NICS },
    });
    try {
      expect(socket.start).toHaveBeenCalledTimes(1);
      expect(ask('mipc-1.local')).toBe(1); // nombre saneado
      expect(ask('krakenos.local')).toBe(2); // alias fijo
    } finally {
      expect(socket.close).not.toHaveBeenCalled();
      await app.close();
    }
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('con modo off no abre el socket', async () => {
    const { socket } = fakeSocket();
    const app = await buildServer({
      setupTokenFile: tokenTemporal(),
      mdns: { mode: 'off', socket, interfaces: () => NICS },
    });
    await app.close();
    expect(socket.start).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
  });
});
