import { describe, expect, it } from 'vitest';
import { FeatureNotSupportedError, MikrotikDriver } from '../../src/drivers/mikrotik.driver.js';
import { cliProps, menuToCli } from '../../src/drivers/mikrotik.transport.js';
import type { MikrotikTransport } from '../../src/drivers/mikrotik.transport.js';

interface AddCall {
  menu: string;
  props: Record<string, string>;
}
interface SetCall {
  menu: string;
  id: string;
  props: Record<string, string>;
}

/** Transporte falso: `list` por menú desde un mapa, registra add/set/remove. */
class FakeTransport implements MikrotikTransport {
  adds: AddCall[] = [];
  sets: SetCall[] = [];
  removes: { menu: string; id: string }[] = [];

  constructor(private readonly data: Record<string, Record<string, unknown>[]> = {}) {}

  async list(menu: string): Promise<Record<string, unknown>[]> {
    if (!(menu in this.data)) throw new Error(`menú no disponible: ${menu}`);
    return this.data[menu]!;
  }
  async add(menu: string, props: Record<string, string>): Promise<void> {
    this.adds.push({ menu, props });
  }
  async set(menu: string, id: string, props: Record<string, string>): Promise<void> {
    this.sets.push({ menu, id, props });
  }
  async remove(menu: string, id: string): Promise<void> {
    this.removes.push({ menu, id });
  }
}

const ARP = [{ address: '192.168.88.10', 'mac-address': 'AA:BB:CC:DD:EE:FF' }];

function makeDriver(data: Record<string, Record<string, unknown>[]>, now?: () => number) {
  const transport = new FakeTransport(data);
  return { transport, driver: new MikrotikDriver({ transport, wanInterface: 'ether1', now }) };
}

describe('mikrotik.transport helpers', () => {
  it('menuToCli convierte el menú REST a ruta CLI', () => {
    expect(menuToCli('ip/firewall/address-list')).toBe('/ip firewall address-list');
    expect(menuToCli('interface/wireless')).toBe('/interface wireless');
  });

  it('cliProps entrecomilla los valores con espacios', () => {
    expect(cliProps({ list: 'krakenos-blocked', comment: 'mi pc' })).toBe(
      'list=krakenos-blocked comment="mi pc"',
    );
  });
});

describe('MikrotikDriver', () => {
  it('scanArp/scanMdns mapean ARP y leases (mdns degrada a [])', async () => {
    const { driver } = makeDriver({
      'ip/arp': ARP,
      'ip/dhcp-server/lease': [
        { address: '192.168.88.20', 'mac-address': '11:22:33:44:55:66', 'host-name': 'pc' },
      ],
    });
    expect((await driver.scanArp())[0]).toMatchObject({ mac: 'aa:bb:cc:dd:ee:ff', source: 'arp' });
    expect((await driver.scanMdns())[0]).toMatchObject({ hostname: 'pc', source: 'mdns' });

    const { driver: noLeases } = makeDriver({ 'ip/arp': ARP }); // sin menú leases → []
    expect(await noLeases.scanMdns()).toEqual([]);
  });

  it('getTrafficSample calcula la tasa con el reloj inyectado y lanza si no hay WAN', async () => {
    let rx = 1_000_000;
    const data: Record<string, Record<string, unknown>[]> = {
      interface: [{ name: 'ether1', 'rx-byte': String(rx), 'tx-byte': '0' }],
    };
    let clock = 1_000_000;
    const transport = new FakeTransport(data);
    const driver = new MikrotikDriver({ transport, wanInterface: 'ether1', now: () => clock });

    expect((await driver.getTrafficSample()).wan.rxBytesPerSec).toBe(0);
    rx = 3_000_000;
    data.interface = [{ name: 'ether1', 'rx-byte': String(rx), 'tx-byte': '0' }];
    clock += 2_000;
    expect((await driver.getTrafficSample()).wan.rxBytesPerSec).toBe(1_000_000);

    const { driver: noWan } = makeDriver({ interface: [{ name: 'ether9' }] });
    await expect(noWan.getTrafficSample()).rejects.toThrow(/Interfaz WAN no encontrada/);
  });

  it('blockDevice resuelve IP por ARP, crea la regla drop y la entrada de address-list', async () => {
    const { transport, driver } = makeDriver({
      'ip/arp': ARP,
      'ip/firewall/filter': [], // sin regla drop todavía
      'ip/firewall/address-list': [],
    });
    await driver.blockDevice('AA:BB:CC:DD:EE:FF');

    const rule = transport.adds.find((a) => a.menu === 'ip/firewall/filter');
    expect(rule!.props).toMatchObject({ 'src-address-list': 'krakenos-blocked', action: 'drop' });
    const entry = transport.adds.find((a) => a.menu === 'ip/firewall/address-list');
    expect(entry!.props).toMatchObject({
      list: 'krakenos-blocked',
      address: '192.168.88.10',
      comment: 'krakenos-block:aa:bb:cc:dd:ee:ff',
    });
  });

  it('blockDevice no duplica la regla drop si ya existe', async () => {
    const { transport, driver } = makeDriver({
      'ip/arp': ARP,
      'ip/firewall/filter': [{ 'src-address-list': 'krakenos-blocked', action: 'drop' }],
      'ip/firewall/address-list': [],
    });
    await driver.blockDevice('AA:BB:CC:DD:EE:FF');
    expect(transport.adds.filter((a) => a.menu === 'ip/firewall/filter')).toHaveLength(0);
  });

  it('blockDevice lanza si la MAC no está en ARP', async () => {
    const { driver } = makeDriver({ 'ip/arp': [] });
    await expect(driver.blockDevice('aa:bb:cc:dd:ee:ff')).rejects.toThrow(/No se encontró IP/);
  });

  it('unblockDevice borra la entrada etiquetada de la address-list', async () => {
    const { transport, driver } = makeDriver({
      'ip/arp': ARP,
      'ip/firewall/address-list': [
        { '.id': '*7', list: 'krakenos-blocked', comment: 'krakenos-block:aa:bb:cc:dd:ee:ff' },
      ],
    });
    await driver.unblockDevice('AA:BB:CC:DD:EE:FF');
    expect(transport.removes).toEqual([{ menu: 'ip/firewall/address-list', id: '*7' }]);
  });

  it('WiFi: getWifi/updateWifi operan sobre wireless; sin wireless lanza FeatureNotSupportedError', async () => {
    const { transport, driver } = makeDriver({
      'interface/wireless': [
        { '.id': '*1', name: 'wlan1', ssid: 'Casa', band: '2ghz-g/n', disabled: 'false' },
      ],
    });
    expect(await driver.getWifi()).toMatchObject({ ssid: 'Casa', band: '2.4GHz' });
    await driver.updateWifi({ ssid: 'Nueva', enabled: false });
    expect(transport.sets[0]).toMatchObject({
      menu: 'interface/wireless',
      id: '*1',
      props: { ssid: 'Nueva', disabled: 'yes' },
    });

    const { driver: noWifi } = makeDriver({}); // menú wireless ausente
    await expect(noWifi.getWifi()).rejects.toThrow(FeatureNotSupportedError);
    expect(await noWifi.listAccessPoints()).toEqual([]);
    expect(await noWifi.listWifiNetworks()).toEqual([]);
  });
});
