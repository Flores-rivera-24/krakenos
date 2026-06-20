import { beforeEach, describe, expect, it } from 'vitest';
import { OpenWrtDriver } from '../../src/drivers/openwrt.driver.js';
import type { CommandOutput, OpenWrtTransport } from '../../src/drivers/openwrt.transport.js';

const ARP = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.42     0x1         0x2         f0:18:98:aa:bb:cc     *        br-lan
192.168.1.50     0x1         0x2         dc:a6:32:de:ad:02     *        br-lan`;

const NET_DEV_1 = `Inter-|   Receive                                                |  Transmit
 face |bytes
   wan: 1000000   500    0    0    0     0          0         0   200000    300    0    0    0     0       0          0`;
const NET_DEV_2 = `Inter-|   Receive                                                |  Transmit
 face |bytes
   wan: 3000000   900    0    0    0     0          0         0   600000    700    0    0    0     0       0          0`;

const UCI = `wireless.radio0=wifi-device
wireless.radio0.band='5g'
wireless.default_radio0=wifi-iface
wireless.default_radio0.device='radio0'
wireless.default_radio0.mode='ap'
wireless.default_radio0.ssid='KrakenOS'
wireless.default_radio0.encryption='sae-mixed'
wireless.default_radio0.network='lan'
wireless.default_radio0.ifname='wlan0'
wireless.default_radio0.disabled='0'
wireless.guest_radio0=wifi-iface
wireless.guest_radio0.device='radio0'
wireless.guest_radio0.ssid='Invitados'
wireless.guest_radio0.encryption='psk2'
wireless.guest_radio0.network='guest'
wireless.guest_radio0.isolate='1'
wireless.guest_radio0.disabled='1'`;

/** Transporte falso: responde por coincidencia de prefijo de comando. */
class FakeTransport implements OpenWrtTransport {
  calls: string[] = [];
  private rules: { match: string; out: Partial<CommandOutput> }[] = [];
  /** Salidas en cola para un mismo comando (p. ej. dos lecturas de /proc/net/dev). */
  private queues = new Map<string, string[]>();

  on(match: string, stdout: string, code = 0): this {
    this.rules.push({ match, out: { stdout, code } });
    return this;
  }

  queue(match: string, stdouts: string[]): this {
    this.queues.set(match, [...stdouts]);
    return this;
  }

  async exec(command: string): Promise<CommandOutput> {
    this.calls.push(command);
    for (const [match, q] of this.queues) {
      if (command.startsWith(match) && q.length) {
        return { stdout: q.shift()!, stderr: '', code: 0 };
      }
    }
    for (const r of this.rules) {
      if (command.startsWith(r.match)) {
        return { stdout: r.out.stdout ?? '', stderr: '', code: r.out.code ?? 0 };
      }
    }
    return { stdout: '', stderr: '', code: 0 };
  }

  ran(prefix: string): boolean {
    return this.calls.some((c) => c.startsWith(prefix));
  }
}

function baseTransport(): FakeTransport {
  return new FakeTransport()
    .on('cat /proc/uptime', '1234.5 5678.9')
    .on('cat /proc/net/arp', ARP)
    .on('uci show wireless', UCI)
    .on('uci -q get system', 'router-casa');
}

describe('OpenWrtDriver', () => {
  let t: FakeTransport;

  beforeEach(() => {
    t = baseTransport();
  });

  function makeDriver(now?: () => number) {
    return new OpenWrtDriver({ transport: t, wanInterface: 'wan', host: '192.168.1.1', now });
  }

  it('healthcheck es true si el comando responde', async () => {
    expect(await makeDriver().healthcheck()).toBe(true);
  });

  it('scanArp parsea la tabla ARP', async () => {
    const devices = await makeDriver().scanArp();
    expect(devices.map((d) => d.mac)).toEqual(['f0:18:98:aa:bb:cc', 'dc:a6:32:de:ad:02']);
    expect(devices.every((d) => d.source === 'arp')).toBe(true);
  });

  it('scanMdns fusiona umdns + leases con la MAC vía ARP', async () => {
    t.on('ubus call umdns hosts', JSON.stringify({ 'mac.local': { ipv4: '192.168.1.42', host: 'macbook' } }));
    t.on('cat /tmp/dhcp.leases', '1700000000 dc:a6:32:de:ad:02 192.168.1.50 raspberrypi 01:x');
    const devices = await makeDriver().scanMdns();
    const byMac = Object.fromEntries(devices.map((d) => [d.mac, d]));
    expect(byMac['f0:18:98:aa:bb:cc']).toMatchObject({ hostname: 'macbook', source: 'mdns' });
    expect(byMac['dc:a6:32:de:ad:02']).toMatchObject({ hostname: 'raspberrypi', ip: '192.168.1.50' });
  });

  it('scanMdns degrada a [] si no hay umdns ni leases', async () => {
    t.on('ubus call umdns hosts', '', 1).on('cat /tmp/dhcp.leases', '', 1);
    expect(await makeDriver().scanMdns()).toEqual([]);
  });

  it('getTrafficSample: primera muestra 0, segunda calcula la tasa con el reloj inyectado', async () => {
    t.queue('cat /proc/net/dev', [NET_DEV_1, NET_DEV_2]);
    let clock = 1_000_000;
    const driver = makeDriver(() => clock);

    const first = await driver.getTrafficSample();
    expect(first.wan).toMatchObject({ rxBytesPerSec: 0, txBytesPerSec: 0 });

    clock += 2_000; // +2 s
    const second = await driver.getTrafficSample();
    // rx: (3_000_000 - 1_000_000)/2 = 1_000_000 ; tx: (600_000 - 200_000)/2 = 200_000
    expect(second.wan).toMatchObject({ rxBytesPerSec: 1_000_000, txBytesPerSec: 200_000 });
  });

  it('blockDevice ejecuta la regla iptables de la MAC', async () => {
    await makeDriver().blockDevice('F0:18:98:AA:BB:CC');
    expect(t.ran('iptables -w -C FORWARD -m mac --mac-source f0:18:98:aa:bb:cc')).toBe(true);
  });

  it('getWifi mapea la iface principal (no invitados)', async () => {
    const wifi = await makeDriver().getWifi();
    expect(wifi).toMatchObject({
      ssid: 'KrakenOS',
      enabled: true,
      band: '5GHz',
      security: 'wpa2/wpa3',
      hidden: false,
    });
  });

  it('updateWifi emite los uci set correctos + commit + reload', async () => {
    await makeDriver().updateWifi({ ssid: 'Nueva', enabled: false, band: '2.4GHz' });
    expect(t.ran("uci set wireless.default_radio0.ssid='Nueva'")).toBe(true);
    expect(t.ran("uci set wireless.default_radio0.disabled='1'")).toBe(true);
    expect(t.ran("uci set wireless.radio0.band='2g'")).toBe(true);
    expect(t.ran('uci commit wireless')).toBe(true);
    expect(t.ran('wifi reload')).toBe(true);
  });

  it('getGuestNetwork mapea la iface de invitados', async () => {
    const guest = await makeDriver().getGuestNetwork();
    expect(guest).toMatchObject({ ssid: 'Invitados', enabled: false, clientIsolation: true, bandwidthLimitMbps: null });
  });

  it('listAccessPoints devuelve el dispositivo como único AP', async () => {
    const aps = await makeDriver().listAccessPoints();
    expect(aps).toHaveLength(1);
    expect(aps[0]).toMatchObject({ id: 'openwrt', name: 'router-casa', ip: '192.168.1.1', networkCount: 2 });
  });

  it('listWifiNetworks mapea cada iface y marca invitados', async () => {
    const nets = await makeDriver().listWifiNetworks();
    expect(nets.map((n) => n.id)).toEqual(['default_radio0', 'guest_radio0']);
    expect(nets[1]).toMatchObject({ isGuest: true, enabled: false });
  });

  it('getWifiNetwork devuelve null para id inexistente', async () => {
    expect(await makeDriver().getWifiNetwork('no-existe')).toBeNull();
  });

  it('updateWifiNetwork null si la red no existe, aplica si existe', async () => {
    const driver = makeDriver();
    expect(await driver.updateWifiNetwork('no-existe', { ssid: 'X' })).toBeNull();
    await driver.updateWifiNetwork('guest_radio0', { ssid: 'NuevoInvitado' });
    expect(t.ran("uci set wireless.guest_radio0.ssid='NuevoInvitado'")).toBe(true);
  });

  it('listNetworkClients junta iwinfo (señal) con ARP (ip) y leases (hostname)', async () => {
    t.on("iwinfo 'wlan0' assoclist", 'F0:18:98:AA:BB:CC  -48 dBm / -95 dBm (SNR 47)  3000 ms ago');
    t.on('cat /tmp/dhcp.leases', '1700000000 f0:18:98:aa:bb:cc 192.168.1.42 macbook 01:x');
    const clients = await makeDriver().listNetworkClients('default_radio0');
    expect(clients).toEqual([
      { mac: 'f0:18:98:aa:bb:cc', hostname: 'macbook', ip: '192.168.1.42', signalDbm: -48 },
    ]);
  });

  it('listNetworkClients devuelve null para una red inexistente', async () => {
    expect(await makeDriver().listNetworkClients('no-existe')).toBeNull();
  });
});
