import { beforeEach, describe, expect, it } from 'vitest';
import { UnifiDriver } from '../../src/drivers/unifi.driver.js';
import type {
  UnifiHttpFetch,
  UnifiHttpRequestInit,
  UnifiHttpResponse,
} from '../../src/drivers/unifi.transport.js';
import { UnifiClient, extractTokenCookie } from '../../src/drivers/unifi.transport.js';

interface Call {
  method: string;
  path: string;
  body?: unknown;
  cookie?: string;
  csrf?: string;
}

type Handler = (call: Call) => { status?: number; data?: unknown; setCookie?: string };

/** `fetch` falso: responde por `${METHOD} ${path-sin-query}`. */
class FakeFetch {
  calls: Call[] = [];
  private handlers = new Map<string, Handler>();

  on(key: string, handler: Handler): this {
    this.handlers.set(key, handler);
    return this;
  }

  readonly fetch: UnifiHttpFetch = async (url: string, init: UnifiHttpRequestInit = {}) => {
    const path = url.replace('https://unifi.test', '');
    const bare = path.split('?')[0]!;
    const method = init.method ?? 'GET';
    const call: Call = {
      method,
      path: bare,
      body: init.body ? JSON.parse(init.body) : undefined,
      cookie: init.headers?.['Cookie'],
      csrf: init.headers?.['X-CSRF-Token'],
    };
    this.calls.push(call);
    const handler = this.handlers.get(`${method} ${bare}`);
    const r = handler ? handler(call) : { status: 200, data: null };
    const status = r.status ?? 200;
    const headers: Record<string, string> = {};
    if (r.setCookie) headers['set-cookie'] = r.setCookie;
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => r.data ?? null,
      text: async () => JSON.stringify(r.data ?? null),
    } satisfies UnifiHttpResponse;
  };
}

function loginOk(fake: FakeFetch): FakeFetch {
  return fake.on('POST /api/auth/login', () => ({ status: 200, setCookie: 'TOKEN=jwt-abc; Path=/' }));
}

function makeDriver(fake: FakeFetch, now?: () => number) {
  const client = new UnifiClient({
    url: 'https://unifi.test',
    username: 'admin',
    password: 'pw',
    fetch: fake.fetch,
  });
  return new UnifiDriver({ client, site: 'default', now });
}

const ACTIVE = {
  data: [
    { mac: 'F0:18:98:AA:BB:CC', ip: '192.168.1.42', name: 'macbook', oui: 'Apple', essid: 'Casa', signal: -55 },
    { mac: 'dc:a6:32:de:ad:02', ip: '192.168.1.50', hostname: 'pi' },
  ],
};

describe('UnifiClient transport', () => {
  it('extractTokenCookie saca el valor de TOKEN', () => {
    expect(extractTokenCookie('TOKEN=abc123; Path=/; HttpOnly')).toBe('abc123');
    expect(extractTokenCookie('other=1; TOKEN=xyz; Path=/')).toBe('xyz');
    expect(extractTokenCookie(null)).toBeNull();
  });

  it('hace login antes de la primera petición y reenvía la cookie TOKEN', async () => {
    const fake = loginOk(new FakeFetch()).on('GET /v2/api/site/default/clients/active', () => ({ data: ACTIVE }));
    await makeDriver(fake).scanArp();

    expect(fake.calls[0]!.path).toBe('/api/auth/login');
    const get = fake.calls.find((c) => c.path === '/v2/api/site/default/clients/active');
    expect(get!.cookie).toBe('TOKEN=jwt-abc');
  });

  it('renueva la cookie y reintenta una vez ante un 401', async () => {
    let served = 0;
    const fake = loginOk(new FakeFetch()).on('GET /v2/api/site/default/clients/active', () => {
      served += 1;
      return served === 1 ? { status: 401 } : { data: ACTIVE }; // primer intento caduca
    });
    const devices = await makeDriver(fake).scanArp();

    expect(devices).toHaveLength(2);
    // Dos logins (inicial + renovación) y dos GET (el 401 y el reintento ok).
    expect(fake.calls.filter((c) => c.path === '/api/auth/login')).toHaveLength(2);
    expect(fake.calls.filter((c) => c.path === '/v2/api/site/default/clients/active')).toHaveLength(2);
  });
});

describe('UnifiDriver', () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = loginOk(new FakeFetch());
  });

  it('healthcheck true/false según stat/health', async () => {
    fake.on('GET /v2/api/site/default/stat/health', () => ({ data: [] }));
    expect(await makeDriver(fake).healthcheck()).toBe(true);

    const down = loginOk(new FakeFetch()).on('GET /v2/api/site/default/stat/health', () => ({ status: 500 }));
    expect(await makeDriver(down).healthcheck()).toBe(false);
  });

  it('scanArp mapea clientes activos a dispositivos online', async () => {
    fake.on('GET /v2/api/site/default/clients/active', () => ({ data: ACTIVE }));
    const devices = await makeDriver(fake).scanArp();
    expect(devices.map((d) => d.mac)).toEqual(['f0:18:98:aa:bb:cc', 'dc:a6:32:de:ad:02']);
    expect(devices[0]).toMatchObject({ source: 'arp', vendor: 'Apple', hostname: 'macbook' });
  });

  it('scanMdns usa el histórico de clientes y degrada a [] si falla', async () => {
    fake.on('GET /v2/api/site/default/stat/alluser', () => ({
      data: [{ mac: 'dc:a6:32:de:ad:02', ip: '192.168.1.50', hostname: 'pi' }],
    }));
    expect((await makeDriver(fake).scanMdns())[0]).toMatchObject({ source: 'mdns', hostname: 'pi' });

    const broken = loginOk(new FakeFetch()).on('GET /v2/api/site/default/stat/alluser', () => ({ status: 500 }));
    expect(await makeDriver(broken).scanMdns()).toEqual([]);
  });

  it('getTrafficSample devuelve las tasas WAN de stat/health', async () => {
    fake.on('GET /v2/api/site/default/stat/health', () => ({
      data: [{ subsystem: 'wan', wan_rx_bytes_r: 2_000_000, wan_tx_bytes_r: 400_000 }],
    }));
    expect((await makeDriver(fake).getTrafficSample()).wan).toEqual({
      rxBytesPerSec: 2_000_000,
      txBytesPerSec: 400_000,
    });
  });

  it('blockDevice/unblockDevice golpean el cmd correcto con la MAC en minúsculas', async () => {
    fake
      .on('POST /v2/api/site/default/clients/f0:18:98:aa:bb:cc/block', () => ({ data: null }))
      .on('POST /v2/api/site/default/clients/f0:18:98:aa:bb:cc/unblock', () => ({ data: null }));
    const driver = makeDriver(fake);
    await driver.blockDevice('F0:18:98:AA:BB:CC');
    await driver.unblockDevice('F0:18:98:AA:BB:CC');
    expect(fake.calls.some((c) => c.path.endsWith('/block') && c.method === 'POST')).toBe(true);
    expect(fake.calls.some((c) => c.path.endsWith('/unblock') && c.method === 'POST')).toBe(true);
  });

  it('getWifi/updateWifi operan sobre la WLAN principal (no invitados)', async () => {
    const wlans = [
      { _id: 'w1', name: 'Casa', wlan_band: 'na', enabled: true, is_guest: false, security: 'wpapsk' },
      { _id: 'w2', name: 'Invitados', wlan_band: 'ng', is_guest: true },
    ];
    fake
      .on('GET /v2/api/site/default/wlanconf', () => ({ data: wlans }))
      .on('PUT /v2/api/site/default/wlanconf/w1', () => ({ data: null }));
    const driver = makeDriver(fake);

    expect(await driver.getWifi()).toMatchObject({ ssid: 'Casa', band: '5GHz', enabled: true });
    await driver.updateWifi({ ssid: 'CasaNueva', password: 'secret123' });
    const put = fake.calls.find((c) => c.method === 'PUT');
    expect(put!.path).toBe('/v2/api/site/default/wlanconf/w1');
    expect(put!.body).toMatchObject({ name: 'CasaNueva', x_passphrase: 'secret123' });
  });

  it('listAccessPoints filtra los uap de stat/device', async () => {
    fake.on('GET /v2/api/site/default/stat/device', () => ({
      data: [
        { _id: 'ap1', type: 'uap', name: 'Salón', model: 'U6-Lite', ip: '192.168.1.20', state: 1 },
        { _id: 'sw1', type: 'usw', name: 'Switch' },
      ],
    }));
    const aps = await makeDriver(fake).listAccessPoints();
    expect(aps).toHaveLength(1);
    expect(aps[0]).toMatchObject({ id: 'ap1', name: 'Salón', online: true });
  });
});
