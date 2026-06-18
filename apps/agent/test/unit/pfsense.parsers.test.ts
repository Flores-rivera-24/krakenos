import { describe, expect, it } from 'vitest';
import {
  blockRuleDescr,
  buildBlockRulePayload,
  ipForMac,
  parseFirewallRules,
  parsePfSenseArp,
  parsePfSenseInterfaceCounters,
  parsePfSenseLeases,
} from '../../src/drivers/pfsense.parsers.js';

describe('parsePfSenseArp', () => {
  it('mapea ip/mac, normaliza y deduplica; descarta inválidas', () => {
    const devices = parsePfSenseArp([
      { ip: '192.168.1.42', mac: 'F0:18:98:AA:BB:CC', hostname: 'mac' },
      { ip: '192.168.1.42', mac: 'F0:18:98:AA:BB:CC' }, // dup
      { ip: '192.168.1.99', mac: 'no-mac' }, // inválida
      { ip: '192.168.1.50', mac: 'dc:a6:32:de:ad:02' },
    ]);
    expect(devices).toEqual([
      { ip: '192.168.1.42', mac: 'f0:18:98:aa:bb:cc', source: 'arp' },
      { ip: '192.168.1.50', mac: 'dc:a6:32:de:ad:02', source: 'arp' },
    ]);
  });

  it('tolera data no-array', () => {
    expect(parsePfSenseArp(null)).toEqual([]);
  });
});

describe('parsePfSenseLeases', () => {
  it('mapea solo entradas con hostname y marca source mdns', () => {
    const out = parsePfSenseLeases([
      { ip: '192.168.1.50', mac: 'dc:a6:32:de:ad:02', hostname: 'raspberrypi' },
      { ip: '192.168.1.77', mac: '24:0a:c4:de:ad:01', hostname: '' }, // sin hostname
    ]);
    expect(out).toEqual([
      { ip: '192.168.1.50', mac: 'dc:a6:32:de:ad:02', hostname: 'raspberrypi', source: 'mdns' },
    ]);
  });
});

describe('parsePfSenseInterfaceCounters', () => {
  const data = [
    { name: 'lan', inbytes: 10, outbytes: 20 },
    { name: 'wan', descr: 'WAN', hwif: 'em0', inbytes: '1000000', outbytes: '200000' },
  ];

  it('empareja por name/descr/hwif y lee in/out bytes (string o number)', () => {
    expect(parsePfSenseInterfaceCounters(data, 'wan')).toEqual({ rxBytes: 1000000, txBytes: 200000 });
    expect(parsePfSenseInterfaceCounters(data, 'em0')).toEqual({ rxBytes: 1000000, txBytes: 200000 });
  });

  it('soporta los alias bytesin/bytesout y devuelve null si no existe', () => {
    expect(parsePfSenseInterfaceCounters([{ name: 'wan', bytesin: 5, bytesout: 7 }], 'wan')).toEqual({
      rxBytes: 5,
      txBytes: 7,
    });
    expect(parsePfSenseInterfaceCounters(data, 'opt1')).toBeNull();
  });
});

describe('parseFirewallRules + blockRuleDescr', () => {
  it('extrae {id, descr} y encuentra la regla de bloqueo de una MAC', () => {
    const rules = parseFirewallRules([
      { id: 0, descr: 'Default allow' },
      { id: 1, descr: blockRuleDescr('F0:18:98:AA:BB:CC') },
      { id: 2 }, // sin descr → descartada
    ]);
    expect(rules).toEqual([
      { id: 0, descr: 'Default allow' },
      { id: 1, descr: 'krakenos-block:f0:18:98:aa:bb:cc' },
    ]);
  });
});

describe('ipForMac', () => {
  it('resuelve la IP de una MAC (case-insensitive) o null', () => {
    const arp = parsePfSenseArp([{ ip: '192.168.1.42', mac: 'f0:18:98:aa:bb:cc' }]);
    expect(ipForMac(arp, 'F0:18:98:AA:BB:CC')).toBe('192.168.1.42');
    expect(ipForMac(arp, '00:00:00:00:00:00')).toBeNull();
  });
});

describe('buildBlockRulePayload', () => {
  it('construye una regla block etiquetada con la MAC', () => {
    expect(buildBlockRulePayload('192.168.1.42', 'F0:18:98:AA:BB:CC', 'lan')).toEqual({
      type: 'block',
      interface: ['lan'],
      ipprotocol: 'inet',
      protocol: 'any',
      source: '192.168.1.42',
      destination: 'any',
      descr: 'krakenos-block:f0:18:98:aa:bb:cc',
    });
  });
});
