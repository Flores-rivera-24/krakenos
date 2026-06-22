import { beforeEach, describe, expect, it } from 'vitest';
import { OmadaDriver } from '../../src/drivers/omada.driver.js';
import type {
  OmadaHttpFetch,
  OmadaHttpRequestInit,
  OmadaHttpResponse,
} from '../../src/drivers/omada.transport.js';
import { OmadaClient, extractOmadaCookie } from '../../src/drivers/omada.transport.js';

interface Call {
  method: string;
  path: string;
  body?: unknown;
  cookie?: string;
  csrf?: string;
}

type Handler = (call: Call) => { status?: number; errorCode?: number; data?: unknown; setCookie?: string; token?: string };

class FakeFetch {
  calls: Call[] = [];
  private handlers = new Map<string, Handler>();

  on(key: string, handler: Handler): this {
    this.handlers.set(key, handler);
    return this;
  }

  readonly fetch: OmadaHttpFetch = async (url: string, init: OmadaHttpRequestInit = {}) => {
    const path = url.replace('https://omada.test', '');
    const bare = path.split('?')[0]!;
    const method = init.method ?? 'GET';
    const call: Call = {
      method,
      path: bare,
      body: init.body ? JSON.parse(init.body) : undefined,
      cookie: init.headers?.['Cookie'],
      csrf: init.headers?.['Csrf-Token'],
    };
    this.calls.push(call);
    const handler = this.handlers.get(`${method} ${bare}`);
    const r = handler ? handler(call) : { status: 200, data: null };
    const status = r.status ?? 200;
    const envelope: Record<string, unknown> = {
      errorCode: r.errorCode ?? 0,
      msg: '',
      result: r.token ? { ...(r.data as object), token: r.token } : r.data ?? null,
    };
    const headers: Record<string, string> = {};
    if (r.setCookie) headers['set-cookie'] = r.setCookie;
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      json: async () => envelope,
      text: async () => JSON.stringify(envelope),
    } satisfies OmadaHttpResponse;
  };
}

const OMADAC = 'oc1';
const SITE = 'site-123';

/** Configura login + autodetección de omadacId + resolución de siteId. */
function withContext(fake: FakeFetch): FakeFetch {
  return fake
    .on('POST /api/v2/hotspot/login', () => ({ setCookie: 'TPOMADA_SESSIONID=sess-1; Path=/', token: 'csrf-1' }))
    .on('GET /api/info', () => ({ data: { omadacId: OMADAC } }))
    .on(`GET /api/v2/${OMADAC}/users/current`, () => ({
      data: { privilege: { sites: [{ name: 'Default', key: SITE }] } },
    }));
}

function makeDriver(fake: FakeFetch, now?: () => number) {
  const client = new OmadaClient({ url: 'https://omada.test', username: 'admin', password: 'pw', fetch: fake.fetch });
  return new OmadaDriver({ client, siteName: 'Default', now });
}

const CLIENTS = {
  data: [
    { mac: 'AA-BB-CC-DD-EE-FF', ip: '192.168.1.42', name: 'macbook', vendor: 'Apple', ssid: 'Casa', signal: -50 },
    { mac: '11-22-33-44-55-66', ip: '192.168.1.50', hostName: 'pi' },
  ],
};

describe('OmadaClient transport', () => {
  it('extractOmadaCookie saca TPOMADA_SESSIONID', () => {
    expect(extractOmadaCookie('TPOMADA_SESSIONID=abc; Path=/; HttpOnly')).toBe('abc');
    expect(extractOmadaCookie(null)).toBeNull();
  });

  it('hace login, autodetecta omadacId/siteId y reenvía cookie + Csrf-Token', async () => {
    const fake = withContext(new FakeFetch()).on(
      `GET /api/v2/${OMADAC}/clients`,
      () => ({ data: CLIENTS }),
    );
    await makeDriver(fake).scanArp();

    expect(fake.calls[0]!.path).toBe('/api/v2/hotspot/login');
    const clientsCall = fake.calls.find((c) => c.path === `/api/v2/${OMADAC}/clients`);
    expect(clientsCall!.cookie).toBe('TPOMADA_SESSIONID=sess-1');
    expect(clientsCall!.csrf).toBe('csrf-1');
  });

  it('renueva la sesión y reintenta una vez ante un 401', async () => {
    let served = 0;
    const fake = withContext(new FakeFetch()).on(`GET /api/v2/${OMADAC}/clients`, () => {
      served += 1;
      return served === 1 ? { status: 401 } : { data: CLIENTS };
    });
    const devices = await makeDriver(fake).scanArp();

    expect(devices).toHaveLength(2);
    expect(fake.calls.filter((c) => c.path === '/api/v2/hotspot/login')).toHaveLength(2);
  });
});

describe('OmadaDriver', () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = withContext(new FakeFetch());
  });

  it('scanArp mapea clientes activos (MAC con guiones → :)', async () => {
    fake.on(`GET /api/v2/${OMADAC}/clients`, () => ({ data: CLIENTS }));
    const devices = await makeDriver(fake).scanArp();
    expect(devices.map((d) => d.mac)).toEqual(['aa:bb:cc:dd:ee:ff', '11:22:33:44:55:66']);
    expect(devices[0]).toMatchObject({ source: 'arp', vendor: 'Apple' });
  });

  it('getTrafficSample lee wanDownload/wanUpload del overviewDashboard', async () => {
    fake.on(`GET /api/v2/${OMADAC}/sites/${SITE}/dashboard/overviewDashboard`, () => ({
      data: { wanDownload: 3_000_000, wanUpload: 500_000 },
    }));
    expect((await makeDriver(fake).getTrafficSample()).wan).toEqual({
      rxBytesPerSec: 3_000_000,
      txBytesPerSec: 500_000,
    });
  });

  it('blockDevice/unblockDevice postean el cmd de site con la MAC', async () => {
    fake
      .on(`POST /api/v2/${OMADAC}/sites/${SITE}/cmd/clients/block`, () => ({ data: null }))
      .on(`POST /api/v2/${OMADAC}/sites/${SITE}/cmd/clients/unblock`, () => ({ data: null }));
    const driver = makeDriver(fake);
    await driver.blockDevice('AA:BB:CC:DD:EE:FF');
    await driver.unblockDevice('AA:BB:CC:DD:EE:FF');
    const block = fake.calls.find((c) => c.path.endsWith('/cmd/clients/block'));
    expect(block!.body).toEqual({ mac: 'aa:bb:cc:dd:ee:ff' });
  });

  it('getWifi/updateWifi operan sobre la WLAN principal (PATCH con psk)', async () => {
    const wlans = {
      data: [
        { id: 'w1', name: 'Casa', wlanBand: 1, security: 3, enable: true, broadcast: true },
        { id: 'w2', name: 'Invitados', guestNetEnable: true },
      ],
    };
    fake
      .on(`GET /api/v2/${OMADAC}/sites/${SITE}/setting/wlans`, () => ({ data: wlans }))
      .on(`PATCH /api/v2/${OMADAC}/sites/${SITE}/setting/wlans/w1`, () => ({ data: null }));
    const driver = makeDriver(fake);

    expect(await driver.getWifi()).toMatchObject({ ssid: 'Casa', band: '5GHz' });
    await driver.updateWifi({ ssid: 'CasaNueva', password: 'secret123' });
    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect(patch!.path).toBe(`/api/v2/${OMADAC}/sites/${SITE}/setting/wlans/w1`);
    expect(patch!.body).toMatchObject({ name: 'CasaNueva', psk: 'secret123' });
  });

  it('listAccessPoints consulta devices?type=ap del site', async () => {
    fake.on(`GET /api/v2/${OMADAC}/sites/${SITE}/devices`, () => ({
      data: { data: [{ mac: 'AA-BB-CC-DD-EE-01', name: 'EAP-Salón', model: 'EAP670', ip: '192.168.1.20', status: 11, clientNum: 3 }] },
    }));
    const aps = await makeDriver(fake).listAccessPoints();
    expect(aps).toHaveLength(1);
    expect(aps[0]).toMatchObject({ id: 'aa:bb:cc:dd:ee:01', online: true, networkCount: 3 });
  });
});
