import { describe, expect, it, vi } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import {
  MdnsResponder,
  addressesFromInterfaces,
  answerFor,
  sourceOnLink,
  type ResponderSocket,
} from '../../src/discovery/mdns-responder.js';
import { parseMdnsResponse } from '../../src/discovery/dns.js';

const IPS = { v4: ['192.168.1.10'], v6: ['fd12:3456:789a::1'] };

/** Pregunta mDNS armada a mano: un nombre, tipo y clase dados. */
function query(
  name: string,
  type = 1,
  qclass = 1,
  opts: { flags?: number; extra?: Buffer } = {},
): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(opts.flags ?? 0, 2);
  header.writeUInt16BE(1, 4);
  const labels = name
    .split('.')
    .map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(qclass, 2);
  return Buffer.concat([header, ...labels, Buffer.from([0]), tail, opts.extra ?? Buffer.alloc(0)]);
}

describe('answerFor', () => {
  it('contesta un A por su nombre con TTL 120 y flush', () => {
    const r = answerFor(query('mipc.local'), 'mipc', IPS)!;
    expect(r.readUInt16BE(2)).toBe(0x8400); // respuesta autoritativa
    expect(r.readUInt16BE(6)).toBe(1);
    // nombre (1+4+1+5+1 = 12 bytes) y luego tipo, clase, ttl, rdlength, rdata
    const off = 12 + 12;
    expect(r.readUInt16BE(off)).toBe(1);
    expect(r.readUInt16BE(off + 2)).toBe(0x8001);
    expect(r.readUInt32BE(off + 4)).toBe(120);
    expect([...r.subarray(off + 10, off + 14)]).toEqual([192, 168, 1, 10]);
  });

  it('no contesta por otro nombre', () => {
    expect(answerFor(query('otro.local'), 'mipc', IPS)).toBeNull();
  });

  it('contesta en mayúsculas (DNS no distingue)', () => {
    expect(answerFor(query('MiPC.LOCAL'), 'mipc', IPS)).not.toBeNull();
  });

  it('contesta AAAA solo con ULA y A+AAAA en un ANY', () => {
    const aaaa = answerFor(query('mipc.local', 28), 'mipc', IPS)!;
    expect(aaaa.readUInt16BE(6)).toBe(1);
    expect(aaaa.readUInt16BE(24)).toBe(28);
    const any = answerFor(query('mipc.local', 255), 'mipc', IPS)!;
    expect(any.readUInt16BE(6)).toBe(2);
  });

  it('sin IP del tipo pedido no contesta', () => {
    expect(answerFor(query('mipc.local', 28), 'mipc', { v4: ['10.0.0.2'], v6: [] })).toBeNull();
  });

  it('ignora tipos que no es A/AAAA y clases ajenas', () => {
    expect(answerFor(query('mipc.local', 16), 'mipc', IPS)).toBeNull();
    expect(answerFor(query('mipc.local', 1, 3), 'mipc', IPS)).toBeNull();
  });

  it('ignora respuestas ajenas (QR=1)', () => {
    expect(answerFor(query('mipc.local', 1, 1, { flags: 0x8400 }), 'mipc', IPS)).toBeNull();
  });

  it('acepta una lista de nombres (nombre propio y krakenos)', () => {
    expect(answerFor(query('krakenos.local'), ['mipc', 'krakenos'], IPS)).not.toBeNull();
  });

  it('descarta basura sin lanzar', () => {
    const basura = [
      Buffer.alloc(0),
      Buffer.from([1, 2, 3]),
      query('mipc.local').subarray(0, 15), // truncado dentro del nombre
      query('mipc.local').subarray(0, 24), // sin los 4 bytes de tipo/clase
      Buffer.concat([Buffer.from([0, 0, 0, 0, 0xff, 0xff]), Buffer.alloc(6)]), // QDCOUNT enorme
      Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]), Buffer.from([0xc0, 12])]), // puntero a sí mismo (QDCOUNT=1)
    ];
    for (const b of basura) expect(answerFor(b, 'mipc', IPS)).toBeNull();
  });

  it('el paquete se puede leer con el parser del repo sin romperse', () => {
    expect(parseMdnsResponse(answerFor(query('mipc.local'), 'mipc', IPS)!)).toEqual([]);
  });
});

function nic(address: string, family: 'IPv4' | 'IPv6', internal = false): NetworkInterfaceInfo {
  return {
    address,
    family,
    internal,
    netmask: family === 'IPv4' ? '255.255.255.0' : 'ffff:ffff:ffff:ffff::',
    cidr: `${address}/${family === 'IPv4' ? 24 : 64}`,
  } as NetworkInterfaceInfo;
}

describe('addressesFromInterfaces', () => {
  it('deja solo privadas y ULA; nunca públicas, link-local, CGNAT ni loopback', () => {
    const r = addressesFromInterfaces({
      eth0: [
        nic('192.168.1.10', 'IPv4'),
        nic('10.1.2.3', 'IPv4'),
        nic('172.20.0.5', 'IPv4'),
        nic('172.32.0.5', 'IPv4'), // fuera de 172.16/12
        nic('8.8.4.4', 'IPv4'), // pública
        nic('169.254.1.1', 'IPv4'), // link-local
        nic('100.64.0.2', 'IPv4'), // CGNAT/Tailscale
        nic('127.0.0.1', 'IPv4', true),
        nic('fe80::1', 'IPv6'),
        nic('2001:db8::1', 'IPv6'),
        nic('fd00::5', 'IPv6'),
        nic('fc00::6', 'IPv6'),
      ],
      lo: undefined,
    });
    expect(r.v4).toEqual(['192.168.1.10', '10.1.2.3', '172.20.0.5']);
    expect(r.v6).toEqual(['fd00::5', 'fc00::6']);
  });
});

describe('unicast legada y subred receptora', () => {
  it('legada: copia el ID, repite la pregunta, TTL <= 10 y sin flush', () => {
    const q = query('mipc.local');
    q.writeUInt16BE(0xbeef, 0);
    const r = answerFor(q, 'mipc', IPS, { legacy: true })!;
    expect(r.readUInt16BE(0)).toBe(0xbeef);
    expect(r.readUInt16BE(4)).toBe(1);
    expect(r.readUInt16BE(6)).toBe(1);
    expect(r.subarray(12, q.length).equals(q.subarray(12))).toBe(true);
    const off = q.length + 12; // tras la pregunta: nombre (12 bytes) y luego tipo
    expect(r.readUInt16BE(off)).toBe(1);
    expect(r.readUInt16BE(off + 2)).toBe(1);
    expect(r.readUInt32BE(off + 4)).toBeLessThanOrEqual(10);
  });

  it('solo anuncia las IPs de la subred del preguntón; sin coincidencia, todas', () => {
    const ifaces = {
      eth0: [nic('192.168.1.10', 'IPv4')],
      vEthernet: [nic('172.20.0.1', 'IPv4')],
    };
    expect(addressesFromInterfaces(ifaces, '172.20.0.7').v4).toEqual(['172.20.0.1']);
    expect(addressesFromInterfaces(ifaces, '192.168.1.50').v4).toEqual(['192.168.1.10']);
    expect(addressesFromInterfaces(ifaces, '10.9.9.9').v4).toEqual(['192.168.1.10', '172.20.0.1']);
  });

  it('el unicast a un origen fuera de nuestras subredes no se envía', async () => {
    const { f, r } = make();
    await r.start();
    f.emit(query('mipc.local', 1, 0x8001), 5353, '8.8.4.4');
    f.emit(query('mipc.local'), 40000, '8.8.4.4');
    expect(f.sent).toHaveLength(0);
  });

  it('el respondedor da la IP de la red que pregunta y no pide interfaces si no es por él', async () => {
    const f = fakeSocket();
    const interfaces = vi.fn(() => ({
      a: [nic('192.168.1.10', 'IPv4')],
      b: [nic('172.20.0.1', 'IPv4')],
    }));
    const r = new MdnsResponder({
      socket: f.socket,
      nombre: 'mipc',
      interfaces,
      now: () => 0,
      log: { warn: vi.fn() },
    });
    await r.start();
    f.emit(query('otro.local'), 5353, '172.20.0.7');
    expect(interfaces).not.toHaveBeenCalled();
    f.emit(query('mipc.local'), 5353, '172.20.0.7');
    expect([...f.sent[0]!.data.subarray(-4)]).toEqual([172, 20, 0, 1]);
  });
});

describe('sourceOnLink (subredes)', () => {
  const v4 = (address: string, netmask: string, prefix: number) => ({
    eth0: [{ ...nic(address, 'IPv4'), netmask, cidr: `${address}/${prefix}` }],
  });

  it('respeta máscaras distintas de /24', () => {
    const c25 = v4('192.168.1.10', '255.255.255.128', 25);
    expect(sourceOnLink(c25, '192.168.1.127')).toBe(true);
    expect(sourceOnLink(c25, '192.168.1.128')).toBe(false);
    const c16 = v4('172.20.5.1', '255.255.0.0', 16);
    expect(sourceOnLink(c16, '172.20.200.9')).toBe(true);
    expect(sourceOnLink(c16, '172.21.0.1')).toBe(false);
  });

  it('IPv6: ULA dentro y fuera del prefijo; fe80 siempre on-link; ignora interfaces internas', () => {
    const ula = { eth0: [nic('fd12:3456:789a::1', 'IPv6')] };
    expect(sourceOnLink(ula, 'fd12:3456:789a::77')).toBe(true);
    expect(sourceOnLink(ula, 'fd12:3456:789b::77')).toBe(false);
    expect(sourceOnLink(ula, '192.168.1.5')).toBe(false);
    expect(sourceOnLink({}, 'fe80::abcd')).toBe(true);
    expect(sourceOnLink({ lo: [nic('127.0.0.1', 'IPv4', true)] }, '127.0.0.9')).toBe(false);
  });
});

function fakeSocket() {
  let onMsg: (m: Buffer, from: { address: string; port: number }) => void = () => {};
  const sent: { data: Buffer; address: string; port: number }[] = [];
  const socket: ResponderSocket = {
    start: vi.fn(async (cb) => {
      onMsg = cb;
    }),
    send: vi.fn((data, address, port) => void sent.push({ data, address, port })),
    close: vi.fn(async () => {}),
  };
  return {
    socket,
    sent,
    emit: (m: Buffer, port = 5353, address = '192.168.1.50') => onMsg(m, { address, port }),
  };
}

function make(
  overrides: Partial<{
    socket: ResponderSocket;
    now: () => number;
    ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>;
  }> = {},
) {
  const f = fakeSocket();
  let t = 1000;
  const log = { warn: vi.fn() };
  const r = new MdnsResponder({
    socket: overrides.socket ?? f.socket,
    nombre: 'mipc',
    interfaces: () => overrides.ifaces ?? { eth0: [nic('192.168.1.10', 'IPv4')] },
    now: overrides.now ?? (() => t),
    log,
  });
  return { f, r, log, advance: (ms: number) => (t += ms) };
}

describe('MdnsResponder', () => {
  it('responde al grupo, o unicast si la pregunta lleva QU o viene de un puerto ajeno', async () => {
    const { f, r, advance } = make();
    expect(await r.start()).toBe('running');
    f.emit(query('mipc.local'));
    expect(f.sent[0]).toMatchObject({ address: '224.0.0.251', port: 5353 });
    advance(1500);
    f.emit(query('mipc.local', 1, 0x8001));
    expect(f.sent[1]).toMatchObject({ address: '192.168.1.50', port: 5353 });
    advance(1500);
    f.emit(query('mipc.local'), 40000);
    expect(f.sent[2]).toMatchObject({ address: '192.168.1.50', port: 40000 });
  });

  it('limita a una respuesta por segundo y destino', async () => {
    const { f, r, advance } = make();
    await r.start();
    for (let i = 0; i < 100; i++) f.emit(query('mipc.local'));
    expect(f.sent).toHaveLength(1);
    advance(1001);
    f.emit(query('mipc.local'));
    expect(f.sent).toHaveLength(2);
  });

  it('la memoria del limitador no crece con orígenes inventados', async () => {
    const wide = {
      eth0: [{ ...nic('10.0.0.1', 'IPv4'), netmask: '255.0.0.0', cidr: '10.0.0.1/8' }],
    };
    const { f, r } = make({ ifaces: wide });
    await r.start();
    for (let i = 0; i < 5000; i++)
      f.emit(query('mipc.local', 1, 0x8001), 5353, `10.${i >> 8}.${i & 255}.1`);
    expect(f.sent.length).toBeGreaterThan(0);
    expect(f.sent.length).toBeLessThanOrEqual(256);
  });

  it('un datagrama basura no lanza ni responde', async () => {
    const { f, r } = make();
    await r.start();
    expect(() => f.emit(Buffer.from([1, 2, 3]))).not.toThrow();
    expect(f.sent).toHaveLength(0);
  });

  it('un fallo al enlazar deja unavailable, avisa una vez y no lanza', async () => {
    const socket: ResponderSocket = {
      start: vi.fn(async () => {
        throw new Error('EADDRINUSE');
      }),
      send: vi.fn(),
      close: vi.fn(async () => {}),
    };
    const { r, log } = make({ socket });
    expect(await r.start()).toEqual({ unavailable: 'EADDRINUSE' });
    expect(await r.start()).toEqual({ unavailable: 'EADDRINUSE' });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('sin IP privada no responde, y stop cierra el socket', async () => {
    const f = fakeSocket();
    const r = new MdnsResponder({
      socket: f.socket,
      nombre: 'mipc',
      interfaces: () => ({ eth0: [nic('8.8.4.4', 'IPv4')] }),
      now: () => 0,
      log: { warn: vi.fn() },
    });
    await r.start();
    f.emit(query('mipc.local'));
    expect(f.sent).toHaveLength(0);
    await r.stop();
    expect(f.socket.close).toHaveBeenCalled();
  });
});
