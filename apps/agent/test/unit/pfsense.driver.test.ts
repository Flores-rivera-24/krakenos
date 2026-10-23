import { beforeEach, describe, expect, it } from 'vitest';
import { PfSenseDriver } from '../../src/drivers/pfsense.driver.js';
import type {
  HttpFetch,
  HttpRequestInit,
  HttpResponse,
} from '../../src/drivers/pfsense.transport.js';
import { PfSenseClient } from '../../src/drivers/pfsense.transport.js';

interface Call {
  method: string;
  path: string;
  body?: unknown;
  apiKey?: string;
  query?: string;
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
      query: path.split('?')[1],
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
  const client = new PfSenseClient({
    baseUrl: 'https://pf.test',
    apiKey: 'KEY123',
    fetch: fake.fetch,
  });
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

    const broken = new FakeFetch().on('GET /api/v2/services/dhcp_server/leases', () => ({
      status: 500,
    }));
    expect(await makeDriver(broken).scanMdns()).toEqual([]);
  });

  it('getTrafficSample: primera 0, segunda calcula la tasa con el reloj inyectado', async () => {
    let rx = 1_000_000;
    let tx = 200_000;
    fake.on('GET /api/v2/status/interface', () => ({
      data: [{ name: 'wan', inbytes: rx, outbytes: tx }],
    }));
    let clock = 1_000_000;
    const driver = makeDriver(fake, () => clock);

    expect((await driver.getTrafficSample()).wan).toMatchObject({
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
    });
    rx = 3_000_000;
    tx = 600_000;
    clock += 2_000;
    expect((await driver.getTrafficSample()).wan).toMatchObject({
      rxBytesPerSec: 1_000_000,
      txBytesPerSec: 200_000,
    });
  });

  it('blockDevice resuelve la IP por ARP, crea la regla y aplica', async () => {
    let created = false;
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }))
      // La relectura tras el POST muestra la regla creada (sin ella, la guarda rechaza).
      .on('GET /api/v2/firewall/rules', () => ({
        data: created
          ? [{ id: 5, descr: 'krakenos-block:f0:18:98:aa:bb:cc', source: '192.168.1.42' }]
          : [],
      }))
      .on('POST /api/v2/firewall/rule', () => {
        created = true;
        return { status: 200, data: { id: 5 } };
      })
      .on('POST /api/v2/firewall/apply', () => ({ data: null }));
    await makeDriver(fake).blockDevice('F0:18:98:AA:BB:CC');

    const post = fake.calls.find((c) => c.path === '/api/v2/firewall/rule');
    expect(post!.body).toMatchObject({
      type: 'block',
      source: '192.168.1.42',
      descr: 'krakenos-block:f0:18:98:aa:bb:cc',
    });
    expect(fake.calls.some((c) => c.path === '/api/v2/firewall/apply')).toBe(true);
  });

  it('blockDevice lanza si la MAC no está en la tabla ARP', async () => {
    fake.on('GET /api/v2/diagnostics/arp_table', () => ({ data: [] }));
    await expect(makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc')).rejects.toThrow(
      /No se encontró IP/,
    );
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

  it('blockDevice no crea otra regla si ya existe la etiquetada para esa MAC', async () => {
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }))
      .on('GET /api/v2/firewall/rules', () => ({
        data: [{ id: 3, descr: 'krakenos-block:f0:18:98:aa:bb:cc', source: '192.168.1.42' }],
      }))
      .on('POST /api/v2/firewall/rule', () => ({ status: 200, data: { id: 5 } }))
      .on('POST /api/v2/firewall/apply', () => ({ data: null }));
    await makeDriver(fake).blockDevice('F0:18:98:AA:BB:CC');

    expect(
      fake.calls.filter((c) => c.method === 'POST' && c.path === '/api/v2/firewall/rule'),
    ).toHaveLength(0);
  });

  it('blockDevice crea la regla nueva, relee y borra solo la vieja, con un solo apply', async () => {
    const descr = 'krakenos-block:f0:18:98:aa:bb:cc';
    let reads = 0;
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }))
      .on('GET /api/v2/firewall/rules', () => {
        reads += 1;
        return {
          data:
            reads === 1
              ? [{ id: 3, descr, source: '192.168.1.99' }]
              : [
                  { id: 3, descr, source: '192.168.1.99' },
                  { id: 4, descr, source: '192.168.1.42' },
                ],
        };
      })
      .on('DELETE /api/v2/firewall/rule', () => ({ data: null }))
      .on('POST /api/v2/firewall/rule', () => ({ data: { id: 4 } }))
      .on('POST /api/v2/firewall/apply', () => ({ data: null }));
    await makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc');

    const seq = fake.calls
      .filter((c) => c.path !== '/api/v2/diagnostics/arp_table')
      .map((c) => `${c.method} ${c.path}${c.query ? '?' + c.query : ''}`);
    expect(seq).toEqual([
      'GET /api/v2/firewall/rules',
      'POST /api/v2/firewall/rule',
      'GET /api/v2/firewall/rules',
      'DELETE /api/v2/firewall/rule?id=3',
      'POST /api/v2/firewall/apply',
    ]);
    const post = fake.calls.find((c) => c.method === 'POST' && c.path === '/api/v2/firewall/rule');
    expect(post!.body).toMatchObject({ source: '192.168.1.42' });
  });

  it('blockDevice no borra nada si falla el POST de la regla nueva', async () => {
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }))
      .on('GET /api/v2/firewall/rules', () => ({
        data: [{ id: 3, descr: 'krakenos-block:f0:18:98:aa:bb:cc', source: '192.168.1.99' }],
      }))
      .on('POST /api/v2/firewall/rule', () => ({ status: 500, data: null }));
    await expect(makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc')).rejects.toThrow();
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('blockDevice sin regla y sin ARP sigue lanzando No se encontró IP', async () => {
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: [] }))
      .on('GET /api/v2/firewall/rules', () => ({ data: [] }));
    await expect(makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc')).rejects.toThrow(
      /No se encontró IP/,
    );
  });

  it('blockDevice con dos reglas de la IP actual deja una: sin POST, un DELETE y un apply', async () => {
    const descr = 'krakenos-block:f0:18:98:aa:bb:cc';
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }))
      .on('GET /api/v2/firewall/rules', () => ({
        data: [
          { id: 3, descr, source: '192.168.1.42' },
          { id: 6, descr, source: '192.168.1.42' },
        ],
      }))
      .on('DELETE /api/v2/firewall/rule', () => ({ data: null }))
      .on('POST /api/v2/firewall/apply', () => ({ data: null }));
    await makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc');

    expect(
      fake.calls.filter((c) => c.path === '/api/v2/firewall/rule' && c.method === 'POST'),
    ).toHaveLength(0);
    expect(fake.calls.filter((c) => c.method === 'DELETE').map((c) => c.query)).toEqual(['id=6']);
    expect(fake.calls.filter((c) => c.path === '/api/v2/firewall/apply')).toHaveLength(1);
  });

  it('blockDevice con una regla correcta no escribe nada ni aplica', async () => {
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }))
      .on('GET /api/v2/firewall/rules', () => ({
        data: [{ id: 3, descr: 'krakenos-block:f0:18:98:aa:bb:cc', source: '192.168.1.42' }],
      }));
    await makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc');
    expect(fake.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('blockDevice conserva la regla existente si el aparato no aparece en ARP', async () => {
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: [] }))
      .on('GET /api/v2/firewall/rules', () => ({
        data: [{ id: 3, descr: 'krakenos-block:f0:18:98:aa:bb:cc', source: '192.168.1.42' }],
      }));
    await expect(makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc')).resolves.toBeUndefined();
    expect(fake.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('blockDevice reconoce el origen con máscara /32 y solo borra la regla vieja', async () => {
    const descr = 'krakenos-block:f0:18:98:aa:bb:cc';
    let reads = 0;
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }))
      .on('GET /api/v2/firewall/rules', () => {
        reads += 1;
        return {
          data:
            reads === 1
              ? [{ id: 3, descr, source: '192.168.1.99' }]
              : [
                  { id: 3, descr, source: '192.168.1.99' },
                  { id: 4, descr, source: '192.168.1.42/32' },
                ],
        };
      })
      .on('DELETE /api/v2/firewall/rule', () => ({ data: null }))
      .on('POST /api/v2/firewall/rule', () => ({ data: { id: 4 } }))
      .on('POST /api/v2/firewall/apply', () => ({ data: null }));
    await makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc');

    expect(fake.calls.filter((c) => c.method === 'DELETE').map((c) => c.query)).toEqual(['id=3']);
    expect(fake.calls.filter((c) => c.path === '/api/v2/firewall/apply')).toHaveLength(1);
  });

  it('blockDevice no reescribe una regla existente con máscara /32', async () => {
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }))
      .on('GET /api/v2/firewall/rules', () => ({
        data: [{ id: 3, descr: 'krakenos-block:f0:18:98:aa:bb:cc', source: '192.168.1.42/32' }],
      }));
    await makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc');
    expect(fake.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('blockDevice rechaza sin borrar ni aplicar si la relectura no muestra la regla nueva', async () => {
    const descr = 'krakenos-block:f0:18:98:aa:bb:cc';
    fake
      .on('GET /api/v2/diagnostics/arp_table', () => ({ data: ARP }))
      .on('GET /api/v2/firewall/rules', () => ({
        data: [{ id: 3, descr, source: '192.168.1.99' }],
      }))
      .on('DELETE /api/v2/firewall/rule', () => ({ data: null }))
      .on('POST /api/v2/firewall/rule', () => ({ data: { id: 4 } }))
      .on('POST /api/v2/firewall/apply', () => ({ data: null }));
    await expect(makeDriver(fake).blockDevice('f0:18:98:aa:bb:cc')).rejects.toThrow(
      'pfSense no muestra la regla recién creada para f0:18:98:aa:bb:cc; no se retiran las anteriores',
    );
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(fake.calls.some((c) => c.path === '/api/v2/firewall/apply')).toBe(false);
  });

  it('unblockDevice borra todas las reglas etiquetadas y aplica una sola vez', async () => {
    fake
      .on('GET /api/v2/firewall/rules', () => ({
        data: [
          { id: 7, descr: 'krakenos-block:f0:18:98:aa:bb:cc' },
          { id: 8, descr: 'otra regla' },
          { id: 9, descr: 'krakenos-block:f0:18:98:aa:bb:cc' },
        ],
      }))
      .on('DELETE /api/v2/firewall/rule', () => ({ data: null }))
      .on('POST /api/v2/firewall/apply', () => ({ data: null }));
    await makeDriver(fake).unblockDevice('f0:18:98:aa:bb:cc');

    const dels = fake.calls.filter((c) => c.method === 'DELETE');
    expect(dels).toHaveLength(2);
    // Orden de mayor a menor id (protege el `sort`).
    expect(dels.map((c) => c.query)).toEqual(['id=9', 'id=7']);
    expect(fake.calls.filter((c) => c.path === '/api/v2/firewall/apply')).toHaveLength(1);
  });

  it('unblockDevice rechaza si el DELETE falla (no traga el error)', async () => {
    fake
      .on('GET /api/v2/firewall/rules', () => ({
        data: [{ id: 7, descr: 'krakenos-block:f0:18:98:aa:bb:cc' }],
      }))
      .on('DELETE /api/v2/firewall/rule', () => ({ status: 500, data: null }));
    await expect(makeDriver(fake).unblockDevice('f0:18:98:aa:bb:cc')).rejects.toThrow();
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
