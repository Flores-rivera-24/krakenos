import { beforeEach, describe, expect, it } from 'vitest';
import { CiscoIosDriver } from '../../src/drivers/cisco-ios.driver.js';
import { MockCiscoTransport } from '../../src/drivers/cisco-ios.transport.js';

const ARP = `Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  192.168.1.1             -   0011.2233.4455  ARPA   GigabitEthernet0/0
Internet  192.168.1.10           12   aabb.ccdd.eeff  ARPA   GigabitEthernet0/1`;

const IFACE_1 = `GigabitEthernet0/0 is up, line protocol is up
     1000 packets input, 1000000 bytes, 0 no buffer
     2000 packets output, 200000 bytes, 0 underruns`;
const IFACE_2 = `GigabitEthernet0/0 is up, line protocol is up
     3000 packets input, 3000000 bytes, 0 no buffer
     4000 packets output, 600000 bytes, 0 underruns`;

function baseTransport(): MockCiscoTransport {
  return new MockCiscoTransport()
    .on('show version', 'cisco WS-C2960-24TT-L (PowerPC405) processor')
    .on('show arp', ARP);
}

describe('CiscoIosDriver', () => {
  let t: MockCiscoTransport;

  beforeEach(() => {
    t = baseTransport();
  });

  function makeDriver(now?: () => number) {
    return new CiscoIosDriver({ transport: t, interface: 'GigabitEthernet0/0', vlan: '1', now });
  }

  it('healthcheck es true si "show version" responde', async () => {
    expect(await makeDriver().healthcheck()).toBe(true);
  });

  it('scanArp descubre dispositivos (MAC normalizada); scanMdns es vacío', async () => {
    const driver = makeDriver();
    expect(await driver.scanArp()).toEqual([
      { mac: '00:11:22:33:44:55', ip: '192.168.1.1', source: 'arp' },
      { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', source: 'arp' },
    ]);
    expect(await driver.scanMdns()).toEqual([]);
  });

  it('getTrafficSample calcula la tasa por delta entre muestras', async () => {
    t.queue('show interfaces', [IFACE_1, IFACE_2]);
    let clock = 1000;
    const driver = makeDriver(() => clock);
    const first = await driver.getTrafficSample();
    expect(first).toMatchObject({ rxBytesPerSec: 0, txBytesPerSec: 0 });
    clock = 3000; // +2 s
    const second = await driver.getTrafficSample();
    // rx: (3000000-1000000)/2 = 1_000_000 ; tx: (600000-200000)/2 = 200_000
    expect(second).toMatchObject({ rxBytesPerSec: 1_000_000, txBytesPerSec: 200_000 });
  });

  it('blockDevice/unblockDevice emiten la secuencia privilegiada con la MAC Cisco', async () => {
    const driver = makeDriver();
    await driver.blockDevice('aa:bb:cc:dd:ee:ff');
    await driver.unblockDevice('aa:bb:cc:dd:ee:ff');
    expect(t.privileged[0]).toEqual([
      'configure terminal',
      'mac address-table static aabb.ccdd.eeff vlan 1 drop',
      'end',
    ]);
    expect(t.privileged[1]).toEqual([
      'configure terminal',
      'no mac address-table static aabb.ccdd.eeff vlan 1 drop',
      'end',
    ]);
  });

  it('WiFi no está soportado (lanza) y multi-AP devuelve vacío', async () => {
    const driver = makeDriver();
    await expect(driver.getWifi()).rejects.toThrow(/WiFi no gestionado/);
    await expect(driver.updateWifi({})).rejects.toThrow(/WiFi no gestionado/);
    expect(await driver.listAccessPoints()).toEqual([]);
    expect(await driver.listWifiNetworks()).toEqual([]);
    expect(await driver.getWifiNetwork('x')).toBeNull();
    expect(await driver.listNetworkClients('x')).toBeNull();
  });
});
