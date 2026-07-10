import { describe, expect, it } from 'vitest';
import { encodeMdnsQuery, parseMdnsResponse } from '../../src/discovery/dns.js';
import { buildMSearch, parseSsdpResponse } from '../../src/discovery/ssdp.js';

// ---- Constructores de fixtures binarias mDNS ----

function dnsName(name: string): Buffer {
  const chunks: Buffer[] = [];
  for (const label of name.split('.').filter(Boolean)) {
    chunks.push(Buffer.from([label.length]), Buffer.from(label, 'ascii'));
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function dnsRecord(name: Buffer, type: number, rdata: Buffer): Buffer {
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(type, 0);
  fixed.writeUInt16BE(1, 2); // IN
  fixed.writeUInt32BE(120, 4); // TTL
  fixed.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([name, fixed, rdata]);
}

function dnsResponse(answers: Buffer[]): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2); // respuesta autoritativa
  header.writeUInt16BE(answers.length, 6); // ANCOUNT
  return Buffer.concat([header, ...answers]);
}

function srvRdata(port: number, target: Buffer): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16BE(port, 4);
  return Buffer.concat([head, target]);
}

function txtRdata(entries: string[]): Buffer {
  return Buffer.concat(entries.map((e) => Buffer.concat([Buffer.from([e.length]), Buffer.from(e)])));
}

/** Protocolo del auto-descubrimiento (US-175): mDNS/SSDP mínimos y defensivos. */
describe('discovery/dns', () => {
  it('codifica una consulta PTR por servicio con el bit QU', () => {
    const buf = encodeMdnsQuery(['_hue._tcp.local', '_mqtt._tcp.local']);
    expect(buf.readUInt16BE(4)).toBe(2); // QDCOUNT
    // Primera pregunta: nombre + PTR(12) + clase con bit QU (0x8001).
    const nameLen = dnsName('_hue._tcp.local').length;
    expect(buf.readUInt16BE(12 + nameLen)).toBe(12);
    expect(buf.readUInt16BE(12 + nameLen + 2)).toBe(0x8001);
  });

  it('extrae la instancia completa de una respuesta (PTR+SRV+TXT+A)', () => {
    const buf = dnsResponse([
      dnsRecord(dnsName('_hue._tcp.local'), 12, dnsName('Bridge._hue._tcp.local')),
      dnsRecord(dnsName('Bridge._hue._tcp.local'), 33, srvRdata(443, dnsName('hue.local'))),
      dnsRecord(dnsName('Bridge._hue._tcp.local'), 16, txtRdata(['bridgeid=ecb5fa'])),
      dnsRecord(dnsName('hue.local'), 1, Buffer.from([192, 168, 1, 2])),
    ]);
    const out = parseMdnsResponse(buf);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      service: '_hue._tcp.local',
      name: 'Bridge._hue._tcp.local',
      ip: '192.168.1.2',
      port: 443,
      txt: { bridgeid: 'ecb5fa' },
    });
  });

  it('sigue punteros de compresión DNS sin caer en bucles', () => {
    // El PTR apunta con nombre comprimido: la instancia es `Luz` + puntero al
    // servicio en el offset 12 (donde empieza el primer nombre).
    const service = dnsName('_shelly._tcp.local');
    const instanceCompressed = Buffer.concat([
      Buffer.from([3]),
      Buffer.from('Luz'),
      Buffer.from([0xc0, 12]),
    ]);
    const buf = dnsResponse([dnsRecord(service, 12, instanceCompressed)]);
    const out = parseMdnsResponse(buf);
    expect(out[0]?.name).toBe('Luz._shelly._tcp.local');

    // Puntero que se apunta a sí mismo: bucle → paquete descartado sin lanzar.
    const loop = dnsResponse([dnsRecord(Buffer.from([0xc0, 12]), 12, Buffer.from([0xc0, 12]))]);
    expect(parseMdnsResponse(loop)).toEqual([]);
  });

  it('un datagrama malformado o truncado devuelve vacío, nunca lanza', () => {
    expect(parseMdnsResponse(Buffer.alloc(0))).toEqual([]);
    expect(parseMdnsResponse(Buffer.from('no soy dns'))).toEqual([]);
    const valid = dnsResponse([
      dnsRecord(dnsName('_hue._tcp.local'), 12, dnsName('B._hue._tcp.local')),
    ]);
    expect(parseMdnsResponse(valid.subarray(0, valid.length - 3))).toEqual([]);
  });
});

describe('discovery/ssdp', () => {
  it('construye un M-SEARCH multicast estándar', () => {
    const text = buildMSearch().toString('ascii');
    expect(text.startsWith('M-SEARCH * HTTP/1.1\r\n')).toBe(true);
    expect(text).toContain('HOST: 239.255.255.250:1900');
    expect(text).toContain('MAN: "ssdp:discover"');
    expect(text.endsWith('\r\n\r\n')).toBe(true);
  });

  it('parsea las cabeceras de una respuesta 200 y rechaza lo demás', () => {
    const headers = parseSsdpResponse(
      Buffer.from(
        'HTTP/1.1 200 OK\r\nSERVER: Hue/1.0 IpBridge/1.60.0\r\nhue-bridgeid: ECB5FA\r\n\r\n',
      ),
    );
    expect(headers).toMatchObject({ server: 'Hue/1.0 IpBridge/1.60.0', 'hue-bridgeid': 'ECB5FA' });

    expect(parseSsdpResponse(Buffer.from('NOTIFY * HTTP/1.1\r\nNT: upnp:rootdevice\r\n\r\n'))).toBeNull();
    expect(parseSsdpResponse(Buffer.from('basura'))).toBeNull();
  });
});
