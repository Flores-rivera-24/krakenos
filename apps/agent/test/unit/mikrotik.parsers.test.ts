import { describe, expect, it } from 'vitest';
import {
  BLOCK_LIST,
  bandFromMikrotik,
  blockComment,
  blockEntryId,
  ipForMac,
  parseMikrotikArp,
  parseMikrotikInterface,
  parseMikrotikLeases,
  parseMikrotikWireless,
  parseTerse,
} from '../../src/drivers/mikrotik.parsers.js';

describe('mikrotik.parsers', () => {
  it('parseTerse extrae los pares clave=valor (con comillas) de print terse', () => {
    const text = `0 D address=192.168.88.10 mac-address=AA:BB:CC:DD:EE:FF interface=ether2
 1   address=192.168.88.20 mac-address=11:22:33:44:55:66 comment="mi portatil"`;
    expect(parseTerse(text)).toEqual([
      { address: '192.168.88.10', 'mac-address': 'AA:BB:CC:DD:EE:FF', interface: 'ether2' },
      { address: '192.168.88.20', 'mac-address': '11:22:33:44:55:66', comment: 'mi portatil' },
    ]);
  });

  it('parseMikrotikArp + parseMikrotikLeases mapean a Device y deduplican por MAC', () => {
    const arp = [
      { address: '192.168.88.10', 'mac-address': 'AA:BB:CC:DD:EE:FF' },
      { address: '192.168.88.10', 'mac-address': 'AA:BB:CC:DD:EE:FF' }, // dup
      { 'mac-address': '11:22:33:44:55:66' }, // sin IP → fuera
    ];
    expect(parseMikrotikArp(arp)).toEqual([
      { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.88.10', source: 'arp' },
    ]);

    const leases = [
      { address: '192.168.88.20', 'mac-address': '11:22:33:44:55:66', 'host-name': 'portatil' },
      { address: '192.168.88.30', 'mac-address': '99:88:77:66:55:44' }, // sin hostname → fuera
    ];
    expect(parseMikrotikLeases(leases)).toEqual([
      { mac: '11:22:33:44:55:66', ip: '192.168.88.20', hostname: 'portatil', source: 'mdns' },
    ]);
  });

  it('parseMikrotikInterface localiza la WAN y lee rx-byte/tx-byte', () => {
    const rows = [
      { name: 'ether1', 'rx-byte': '1000000', 'tx-byte': '200000' },
      { name: 'ether2', 'rx-byte': '5', 'tx-byte': '5' },
    ];
    expect(parseMikrotikInterface(rows, 'ether1')).toEqual({ rxBytes: 1_000_000, txBytes: 200_000 });
    expect(parseMikrotikInterface(rows, 'wlan9')).toBeNull();
  });

  it('ipForMac y blockEntryId localizan IP y entrada de bloqueo', () => {
    const arp = [{ address: '192.168.88.10', 'mac-address': 'AA:BB:CC:DD:EE:FF' }];
    expect(ipForMac(arp, 'aa:bb:cc:dd:ee:ff')).toBe('192.168.88.10');
    expect(ipForMac(arp, '00:00:00:00:00:00')).toBeNull();

    const entries = [
      { '.id': '*1', list: 'otra', address: '192.168.88.10' },
      { '.id': '*7', list: BLOCK_LIST, address: '192.168.88.10', comment: blockComment('AA:BB:CC:DD:EE:FF') },
    ];
    expect(blockEntryId(entries, 'aa:bb:cc:dd:ee:ff', '192.168.88.10')).toBe('*7');
    expect(blockEntryId(entries, '00:00:00:00:00:00', null)).toBeNull();
  });

  it('bandFromMikrotik y parseMikrotikWireless mapean WiFi', () => {
    expect(bandFromMikrotik('2ghz-g/n')).toBe('2.4GHz');
    expect(bandFromMikrotik('5ghz-a/n/ac')).toBe('5GHz');
    expect(bandFromMikrotik('6ghz-ax')).toBe('6GHz');

    const rows = [
      { '.id': '*1', name: 'wlan1', ssid: 'Casa', band: '5ghz-a/n/ac', disabled: 'false', 'hide-ssid': 'true' },
      { '.id': '*2', name: 'wlan2' }, // sin ssid → fuera
    ];
    expect(parseMikrotikWireless(rows, 'mikrotik')).toEqual([
      { id: '*1', apId: 'mikrotik', ssid: 'Casa', band: '5GHz', security: 'wpa2', enabled: true, hidden: true, isGuest: false, clientCount: 0 },
    ]);
  });
});
