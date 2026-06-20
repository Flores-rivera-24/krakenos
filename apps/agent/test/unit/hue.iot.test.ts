import { beforeEach, describe, expect, it } from 'vitest';
import { HueIotManager } from '../../src/iot/hue.iot.js';
import type { HttpFetch, HttpRequestInit, HttpResponse } from '../../src/iot/hue.transport.js';
import { HueClient } from '../../src/iot/hue.transport.js';

interface Call {
  method: string;
  path: string;
  body?: unknown;
  appKey?: string;
}

type Handler = (call: Call) => { status?: number; data?: unknown };

/** `fetch` falso: responde por `${METHOD} ${path}` con el sobre Hue `{ data }`. */
class FakeFetch {
  calls: Call[] = [];
  private handlers = new Map<string, Handler>();

  on(key: string, handler: Handler): this {
    this.handlers.set(key, handler);
    return this;
  }

  readonly fetch: HttpFetch = async (url: string, init: HttpRequestInit = {}) => {
    const path = url.replace('https://bridge.test', '');
    const method = init.method ?? 'GET';
    const call: Call = {
      method,
      path,
      body: init.body ? JSON.parse(init.body) : undefined,
      appKey: init.headers?.['hue-application-key'],
    };
    this.calls.push(call);
    const handler = this.handlers.get(`${method} ${path}`);
    const r = handler ? handler(call) : { status: 200, data: [] };
    const status = r.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => ({ data: r.data ?? [], errors: [] }),
      text: async () => '',
    } satisfies HttpResponse;
  };
}

const LIGHT = {
  id: 'abc-123',
  metadata: { name: 'Foco salón' },
  on: { on: true },
  dimming: { brightness: 80 },
  color: { xy: { x: 0.5, y: 0.4 } },
  color_temperature: { mirek: null, mirek_valid: false },
};

function makeManager(fake: FakeFetch) {
  const client = new HueClient({ baseUrl: 'https://bridge.test', appKey: 'APPKEY', fetch: fake.fetch });
  return new HueIotManager({ client });
}

describe('HueIotManager', () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = new FakeFetch();
  });

  it('lista las luces y envía la application key', async () => {
    fake.on('GET /clip/v2/resource/light', () => ({ data: [LIGHT] }));
    const devices = await makeManager(fake).listDevices();
    expect(devices[0]).toMatchObject({ id: 'abc-123', name: 'Foco salón', kind: 'light', on: true, brightness: 80 });
    expect(fake.calls[0]!.appKey).toBe('APPKEY');
  });

  it('getDevice devuelve null si el bridge no la trae', async () => {
    fake.on('GET /clip/v2/resource/light/nope', () => ({ data: [] }));
    expect(await makeManager(fake).getDevice('nope')).toBeNull();
  });

  it('setState hace PUT con el cuerpo del color y devuelve estado optimista', async () => {
    fake
      .on('GET /clip/v2/resource/light/abc-123', () => ({ data: [LIGHT] }))
      .on('PUT /clip/v2/resource/light/abc-123', () => ({ data: [{ id: 'abc-123' }] }));

    const updated = await makeManager(fake).setState('abc-123', { color: { hex: '#00ff00' } });
    expect(updated.color).toEqual({ hex: '#00ff00', temperatureK: null });

    const put = fake.calls.find((c) => c.method === 'PUT');
    expect(put!.body).toHaveProperty('color.xy');
  });

  it('setState lanza IOT_NOT_FOUND si la luz no existe', async () => {
    fake.on('GET /clip/v2/resource/light/nope', () => ({ data: [] }));
    await expect(makeManager(fake).setState('nope', { on: true })).rejects.toMatchObject({
      code: 'IOT_NOT_FOUND',
    });
  });
});
