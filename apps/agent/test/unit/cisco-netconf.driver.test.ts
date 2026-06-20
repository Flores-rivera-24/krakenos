import { beforeEach, describe, expect, it } from 'vitest';
import { CiscoNetconfDriver } from '../../src/drivers/cisco-netconf.driver.js';
import { MockNetconfTransport } from '../../src/drivers/cisco-netconf.transport.js';

const ARP_XML = `<data><arp-data>
  <arp-oper><address>192.168.1.1</address><hardware>0011.2233.4455</hardware><interface>Gi1</interface></arp-oper>
</arp-data></data>`;

const IFACE_1 = `<data><interfaces><interface><name>GigabitEthernet1</name>
  <statistics><in-octets>1000000</in-octets><out-octets>200000</out-octets></statistics></interface></interfaces></data>`;
const IFACE_2 = `<data><interfaces><interface><name>GigabitEthernet1</name>
  <statistics><in-octets>3000000</in-octets><out-octets>600000</out-octets></statistics></interface></interfaces></data>`;

describe('CiscoNetconfDriver', () => {
  let t: MockNetconfTransport;

  beforeEach(() => {
    t = new MockNetconfTransport().on('arp-data', ARP_XML);
  });

  function makeDriver(now?: () => number) {
    return new CiscoNetconfDriver({ transport: t, interface: 'GigabitEthernet1', now });
  }

  it('healthcheck es true si el get responde', async () => {
    expect(await makeDriver().healthcheck()).toBe(true);
  });

  it('scanArp descubre dispositivos vía YANG arp-oper; scanMdns es vacío', async () => {
    const driver = makeDriver();
    expect(await driver.scanArp()).toEqual([
      { mac: '00:11:22:33:44:55', ip: '192.168.1.1', source: 'arp' },
    ]);
    expect(await driver.scanMdns()).toEqual([]);
  });

  it('getTrafficSample calcula la tasa por delta entre muestras', async () => {
    // Dos lecturas sucesivas del filtro de interfaces.
    let call = 0;
    t.on('interfaces-oper', IFACE_1);
    const realGet = t.get.bind(t);
    t.get = async (filter: string) => {
      if (filter.includes('interfaces-oper')) return call++ === 0 ? IFACE_1 : IFACE_2;
      return realGet(filter);
    };
    let clock = 1000;
    const driver = makeDriver(() => clock);
    expect((await driver.getTrafficSample()).wan).toMatchObject({ rxBytesPerSec: 0, txBytesPerSec: 0 });
    clock = 3000; // +2 s
    expect((await driver.getTrafficSample()).wan).toMatchObject({
      rxBytesPerSec: 1_000_000,
      txBytesPerSec: 200_000,
    });
  });

  it('blockDevice/unblockDevice emiten edit-config con la ACL MAC', async () => {
    const driver = makeDriver();
    await driver.blockDevice('aa:bb:cc:dd:ee:ff');
    await driver.unblockDevice('aa:bb:cc:dd:ee:ff');
    expect(t.edits[0]).toContain('<source-mac>aabb.ccdd.eeff</source-mac>');
    expect(t.edits[0]).toContain('KRAKENOS-BLOCK');
    expect(t.edits[1]).toContain('nc:operation="delete"');
  });

  it('WiFi no está soportado (lanza) y multi-AP devuelve vacío', async () => {
    const driver = makeDriver();
    await expect(driver.getWifi()).rejects.toThrow(/WiFi no gestionado/);
    expect(await driver.listAccessPoints()).toEqual([]);
    expect(await driver.getWifiNetwork('x')).toBeNull();
  });
});
