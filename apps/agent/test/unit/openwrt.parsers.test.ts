import { describe, expect, it } from 'vitest';
import {
  bandFromDevice,
  isGuestIface,
  parseArpTable,
  parseDhcpLeases,
  parseIwinfoAssoc,
  parseProcNetDev,
  parseUciWireless,
  parseUmdnsHosts,
  securityFromUci,
} from '../../src/drivers/openwrt.parsers.js';

const ARP = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         24:5A:4C:11:22:33     *        br-lan
192.168.1.42     0x1         0x2         f0:18:98:aa:bb:cc     *        br-lan
192.168.1.99     0x1         0x0         00:00:00:00:00:00     *        br-lan`;

describe('parseArpTable', () => {
  it('extrae entradas completas, normaliza MAC y descarta incompletas', () => {
    const devices = parseArpTable(ARP);
    expect(devices).toEqual([
      { mac: '24:5a:4c:11:22:33', ip: '192.168.1.1', source: 'arp' },
      { mac: 'f0:18:98:aa:bb:cc', ip: '192.168.1.42', source: 'arp' },
    ]);
  });

  it('deduplica por MAC y tolera entrada vacía', () => {
    expect(parseArpTable('')).toEqual([]);
  });
});

describe('parseDhcpLeases', () => {
  it('mapea MAC→hostname y descarta hostname `*`', () => {
    const leases = `1700000000 dc:a6:32:de:ad:02 192.168.1.50 raspberrypi 01:dc:a6:32:de:ad:02
1700000001 24:0a:c4:de:ad:01 192.168.1.77 * 01:x`;
    const map = parseDhcpLeases(leases);
    expect(map.get('dc:a6:32:de:ad:02')).toBe('raspberrypi');
    expect(map.has('24:0a:c4:de:ad:01')).toBe(false);
  });
});

describe('parseProcNetDev', () => {
  const dev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:   1000     10    0    0    0     0          0         0     1000     10    0    0    0     0       0          0
   wan: 1000000   500    0    0    0     0          0         0   200000    300    0    0    0     0       0          0`;

  it('lee los contadores rx (campo 0) y tx (campo 8) de la interfaz', () => {
    expect(parseProcNetDev(dev, 'wan')).toEqual({ rxBytes: 1000000, txBytes: 200000 });
  });

  it('devuelve null si la interfaz no aparece', () => {
    expect(parseProcNetDev(dev, 'eth9')).toBeNull();
  });
});

const UCI = `wireless.radio0=wifi-device
wireless.radio0.band='5g'
wireless.radio1=wifi-device
wireless.radio1.band='2g'
wireless.default_radio0=wifi-iface
wireless.default_radio0.device='radio0'
wireless.default_radio0.mode='ap'
wireless.default_radio0.ssid='KrakenOS'
wireless.default_radio0.encryption='sae-mixed'
wireless.default_radio0.network='lan'
wireless.default_radio0.disabled='0'
wireless.guest_radio1=wifi-iface
wireless.guest_radio1.device='radio1'
wireless.guest_radio1.ssid='KrakenOS-Invitados'
wireless.guest_radio1.encryption='psk2'
wireless.guest_radio1.network='guest'
wireless.guest_radio1.isolate='1'
wireless.guest_radio1.disabled='1'`;

describe('parseUciWireless', () => {
  it('separa radios e ifaces y desentrecomilla los valores', () => {
    const w = parseUciWireless(UCI);
    expect(Object.keys(w.devices)).toEqual(['radio0', 'radio1']);
    expect(w.ifaces.map((i) => i.name)).toEqual(['default_radio0', 'guest_radio1']);
    expect(w.ifaces[0]!.options.ssid).toBe('KrakenOS');
    expect(w.devices.radio0!.options.band).toBe('5g');
  });

  it('clasifica la red de invitados por la red UCI', () => {
    const w = parseUciWireless(UCI);
    expect(isGuestIface(w.ifaces[0]!, 'guest')).toBe(false);
    expect(isGuestIface(w.ifaces[1]!, 'guest')).toBe(true);
  });
});

describe('securityFromUci', () => {
  it('mapea los valores de encryption', () => {
    expect(securityFromUci('none')).toBe('open');
    expect(securityFromUci('psk2')).toBe('wpa2');
    expect(securityFromUci('sae')).toBe('wpa3');
    expect(securityFromUci('sae-mixed')).toBe('wpa2/wpa3');
    expect(securityFromUci(undefined)).toBe('open');
  });
});

describe('bandFromDevice', () => {
  it('usa `band` y cae a `hwmode`', () => {
    expect(bandFromDevice({ name: 'r', type: 'wifi-device', options: { band: '2g' } })).toBe('2.4GHz');
    expect(bandFromDevice({ name: 'r', type: 'wifi-device', options: { band: '6g' } })).toBe('6GHz');
    expect(bandFromDevice({ name: 'r', type: 'wifi-device', options: { hwmode: '11a' } })).toBe('5GHz');
    expect(bandFromDevice(undefined)).toBe('2.4GHz');
  });
});

describe('parseIwinfoAssoc', () => {
  it('extrae MAC (minúsculas) y señal dBm', () => {
    const out = parseIwinfoAssoc(`F0:18:98:AA:BB:CC  -48 dBm / -95 dBm (SNR 47)  3000 ms ago
\tRX: 300.0 MBit/s
DC:A6:32:DE:AD:02  -61 dBm / -95 dBm (SNR 34)  1200 ms ago`);
    expect(out).toEqual([
      { mac: 'f0:18:98:aa:bb:cc', signalDbm: -48 },
      { mac: 'dc:a6:32:de:ad:02', signalDbm: -61 },
    ]);
  });
});

describe('parseUmdnsHosts', () => {
  it('extrae hostname e ipv4, envuelto en `host` o directo', () => {
    expect(parseUmdnsHosts({ host: { 'Macbook.local': { ipv4: '192.168.1.42', host: 'Macbook' } } })).toEqual([
      { hostname: 'Macbook', ip: '192.168.1.42' },
    ]);
    expect(parseUmdnsHosts({ 'pi.local': { ipv4: '192.168.1.50' } })).toEqual([
      { hostname: 'pi', ip: '192.168.1.50' },
    ]);
    expect(parseUmdnsHosts({ 'sin-ip.local': {} })).toEqual([]);
  });
});
