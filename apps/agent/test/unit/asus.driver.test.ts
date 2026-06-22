import { beforeEach, describe, expect, it } from 'vitest';
import { AsusDriver } from '../../src/drivers/asus.driver.js';
import type { AsusHttpFetch, AsusHttpRequestInit, AsusHttpResponse } from '../../src/drivers/asus.transport.js';
import { AsusClient } from '../../src/drivers/asus.transport.js';

interface Call {
  method: string;
  path: string;
  hook?: string;
  body?: string;
  auth?: string;
}

type Handler = (call: Call) => { status?: number; text?: string };

class FakeFetch {
  calls: Call[] = [];
  private hooks = new Map<string, Handler>();
  private applyHandler: Handler = () => ({ status: 200, text: '' });

  onHook(hook: string, handler: Handler): this {
    this.hooks.set(hook, handler);
    return this;
  }
  onApply(handler: Handler): this {
    this.applyHandler = handler;
    return this;
  }

  readonly fetch: AsusHttpFetch = async (url: string, init: AsusHttpRequestInit = {}) => {
    const u = new URL(url);
    const hook = u.searchParams.get('hook') ?? undefined;
    const call: Call = {
      method: init.method ?? 'GET',
      path: u.pathname,
      hook,
      body: init.body,
      auth: init.headers?.['Authorization'],
    };
    this.calls.push(call);
    const handler = u.pathname.includes('applyapp')
      ? this.applyHandler
      : (hook && this.hooks.get(hook)) || (() => ({ status: 200, text: '{}' }));
    const r = handler(call);
    const status = r.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => r.text ?? '',
    } satisfies AsusHttpResponse;
  };
}

function makeDriver(fake: FakeFetch, now?: () => number) {
  const client = new AsusClient({ baseUrl: 'http://router.test', username: 'admin', password: 'pw', fetch: fake.fetch });
  return new AsusDriver({ client, host: 'router.test', now });
}

describe('AsusDriver', () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = new FakeFetch();
  });

  it('scanArp parsea get_clientlist y envía Basic Auth', async () => {
    fake.onHook('get_clientlist()', () => ({
      text: JSON.stringify({
        get_clientlist: {
          maclist: ['AA:BB:CC:DD:EE:FF'],
          'AA:BB:CC:DD:EE:FF': { ip: '192.168.1.10', name: 'pc', isOnline: '1' },
        },
      }),
    }));
    const devices = await makeDriver(fake).scanArp();
    expect(devices[0]).toMatchObject({ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10' });
    expect(fake.calls[0]!.auth).toMatch(/^Basic /);
  });

  it('getTrafficSample calcula la tasa con el reloj inyectado', async () => {
    let rx = 1_000_000;
    fake.onHook('get_traffics()', () => ({ text: JSON.stringify({ netdev: { INTERNET: { rx: String(rx), tx: '0' } } }) }));
    let clock = 1_000_000;
    const driver = makeDriver(fake, () => clock);
    expect((await driver.getTrafficSample()).wan.rxBytesPerSec).toBe(0);
    rx = 3_000_000;
    clock += 2_000;
    expect((await driver.getTrafficSample()).wan.rxBytesPerSec).toBe(1_000_000);
  });

  it('blockDevice escribe MULTIFILTER_MAC vía applyapp y reinicia el firewall', async () => {
    fake.onHook('nvram_get(MULTIFILTER_MAC)', () => ({ text: '{"MULTIFILTER_MAC":"11:22:33:44:55:66"}' }));
    await makeDriver(fake).blockDevice('AA:BB:CC:DD:EE:FF');
    const apply = fake.calls.find((c) => c.path.includes('applyapp'));
    expect(apply!.body).toContain('MULTIFILTER_MAC=11%3A22%3A33%3A44%3A55%3A66%3Eaa%3Abb%3Acc%3Add%3Aee%3Aff');
    expect(apply!.body).toContain('rc_service=restart_firewall');
    expect(apply!.body).toContain('action_mode=apply');
  });

  it('getWifi/updateWifi leen y escriben nvram de la banda 2.4 (wl0)', async () => {
    fake.onHook('nvram_get(wl0_ssid);nvram_get(wl0_auth_mode_x);nvram_get(wl0_closed)', () => ({
      text: '{"wl0_ssid":"Casa","wl0_auth_mode_x":"psk2","wl0_closed":"0"}',
    }));
    const driver = makeDriver(fake);
    expect(await driver.getWifi()).toMatchObject({ ssid: 'Casa', band: '2.4GHz', security: 'wpa2', hidden: false });

    await driver.updateWifi({ ssid: 'CasaNueva', password: 'secret123', hidden: true });
    const apply = fake.calls.find((c) => c.path.includes('applyapp'));
    expect(apply!.body).toContain('wl0_ssid=CasaNueva');
    expect(apply!.body).toContain('wl0_wpa_psk=secret123');
    expect(apply!.body).toContain('rc_service=restart_wireless');
  });

  it('la red de invitados no está soportada (baseline): lanza claro', async () => {
    await expect(makeDriver(fake).getGuestNetwork()).rejects.toThrow(/invitados/i);
  });
});
