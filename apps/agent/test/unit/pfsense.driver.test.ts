import { beforeEach, describe, expect, it } from 'vitest';
import { PfSenseDriver } from '../../src/drivers/pfsense.driver.js';
import type { HttpFetch, HttpRequestInit, HttpResponse } from '../../src/drivers/pfsense.transport.js';
import { PfSenseClient } from '../../src/drivers/pfsense.transport.js';

interface Call {
  method: string;
  path: string;
  body?: unknown;
  apiKey?: string;
}

type Handler = (call: Call) => { status?: number; data?: unknown };

/** `fetch` falso: responde por `${METHOD} ${path-sin-query}` con el sobre v2. */
class FakeFetch {
  calls: Call[] = [];
  private handlers = new Map<string, Handler>();

  on(key: string, handler: Handler): this {
    this.handlers.set(key, handler);
    return this;
  }

  readonly fetch: HttpFetch = async (url: string, init: HttpRequestInit = {}) => {
    const path = url.replace('https://pf.test', '');
    const bare = path.split('?')[0]!;
    const method = init.method ?? 'GET';
    const call: Call = {
      method,
      path: bare,
      body: init.body ? JSON.parse(init.body) : undefined,
      apiKey: init.headers?.['X-API-Key'],
    };
    this.calls.push(call);
    const handler = this.handlers.get(`${method} ${bare}`);
    const r = handler ? handler(call) : { status: 200, data: null };
    const status = r.status ?? 200;
    const envelope = { code: status, status: status < 300 ? 'ok' : 'error', data: r.data ?? null };
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => envelope,
      text: async () => JSON.stringify(envelope),
    } satisfies HttpResponse;
  };
}

function makeDriver(fake: FakeFetch, now?: () => number) {
  const client = new PfSenseClient({ baseUrl: 'https://pf.test', apiKey: 'KEY123', fetch: fake.fetch });
  return new PfSenseDriver({ client, wanInterface: 'wan', lanInterface: 'lan', now });
}

const ARP = [
  { ip: '192.168.1.42', mac: 'f0:18:98:aa:bb:cc' },
  { ip: '192.168.1.50', mac: 'dc:a6:32:de:ad:02' },
];

describe('PfSenseDriver', () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = new FakeFetch();
  });

  it('healthcheck true/false según la API y envía la API key', async () => {
    fake.on('GET /api/v2/system/version', () => ({ data: { version: '2.7.2' } }));
    expect(await makeDriver(fake).healthcheck()).toBe(true);
    expect(fake.calls[0]!.apiKey).toBe('KEY123');

    const down = new FakeFetch().on('GET /api/v2/system/version', () => ({ status: 500 }));
    expect(await makeDriver(down).healthcheck()).toBe(false);
  });

  it('scanArp desempaqueta el sobre y parsea la tabla', async () => {
    fake.on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }));
    const devices = await makeDriver(fake).scanArp();
    expect(devices.map((d) => d.mac)).toEqual(['f0:18:98:aa:bb:cc', 'dc:a6:32:de:ad:02']);
  });

  it('scanMdns usa las leases DHCP y degrada a [] si fallan', async () => {
    fake.on('GET /api/v2/services/dhcp_server/leases', () => ({
      data: [{ ip: '192.168.1.50', mac: 'dc:a6:32:de:ad:02', hostname: 'raspberrypi' }],
    }));
    expect(await makeDriver(fake).scanMdns()).toEqual([
      { ip: '192.168.1.50', mac: 'dc:a6:32:de:ad:02', hostname: 'raspberrypi', source: 'mdns' },
    ]);

    const broken = new FakeFetch().on('GET /api/v2/services/dhcp_server/leases', () => ({ status: 500 }));
    expect(await makeDriver(broken).scanMdns()).toEqual([]);
  });

  it('getTrafficSample: primera 0, segunda calcula la tasa con el reloj inyectado', async () => {
    let rx = 1_000_000;
    let tx = 200_000;
    fake.on('GET /api/v2/status/interface', () => ({ data: [{ name: 'wan', inbytes: rx, outbytes: tx }] }));
    let clock = 1_000_000;
    const driver = makeDriver(fake, () => clock);

    expect(await driver.getTrafficSample()).toMatchObject({ rxBytesPerSec: 0, txBytesPerSec: 0 });
    rx = 3_000_000;
    tx = 600_000;
    clock += 2_000;
    expect(await driver.getTrafficSample()).toMatchObject({ rxBytesPerSec: 1_000_000, txBytesPerSec: 200_000 });
  });

  it('blockDevice resuelve la IP por ARP, crea la regla y aplica', async () => {
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }))
      .on('POST /api/v2/firewall/rule', () => ({ status: 200, data: { id: 5 } }))
      .on('POST /api/v2/firewall/apply', () => ({ data: null }));
    await makeDriver(fake).blockDevice('F0:18:98:AA:BB:CC');

    const post = fake.calls.find((c) => c.path === '/api/v2/firewall/rule');
    expect(post!.body).toMatchObject({ type: 'block', source: '192.168.1.42', descr: 'krakenos-block:f0:18:98:aa:bb:cc' });
    expect(fake.calls.some((c) => c.path === '/api/v2/firewall/apply')).toBe(true);
  });

  it('blockDevice lanza si la MAC no está en la tabla ARP', async () => {
    fake.on('GET /api/v2/diagnostics/arp_table', () => ({ data: [] }));
    await expect(makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc')).rejects.toThrow(/No se encontró IP/);
  });

  it('unblockDevice borra la regla etiquetada y aplica', async () => {
    fake
      .on('GET /api/v2/firewall/rules', () => ({
        data: [{ id: 7, descr: 'krakenos-block:f0:18:98:aa:bb:cc' }],
      }))
      .on('DELETE /api/v2/firewall/rule', () => ({ data: null }))
      .on('POST /api/v2/firewall/apply', () => ({ data: null }));
    await makeDriver(fake).unblockDevice('f0:18:98:aa:bb:cc');

    const del = fake.calls.find((c) => c.method === 'DELETE');
    expect(del!.path).toBe('/api/v2/firewall/rule');
  });

  it('WiFi no está soportado: getWifi lanza y multi-AP devuelve vacío', async () => {
    const driver = makeDriver(fake);
    await expect(driver.getWifi()).rejects.toThrow(/WiFi no gestionado/);
    await expect(driver.updateWifi({})).rejects.toThrow(/WiFi no gestionado/);
    await expect(driver.getGuestNetwork()).rejects.toThrow(/WiFi no gestionado/);
    expect(await driver.listAccessPoints()).toEqual([]);
    expect(await driver.listWifiNetworks()).toEqual([]);
    expect(await driver.getWifiNetwork('x')).toBeNull();
    expect(await driver.updateWifiNetwork('x', {})).toBeNull();
    expect(await driver.listNetworkClients('x')).toBeNull();
  });
});
