import { describe, expect, it } from 'vitest';
import { ShellyIotManager } from '../../src/iot/shelly.iot.js';
import type { ShellyTransport } from '../../src/iot/shelly.transport.js';

interface GetCall {
  ip: string;
  path: string;
}
interface RpcCall {
  ip: string;
  body: { method: string; params: Record<string, unknown> };
}

class FakeTransport implements ShellyTransport {
  gets: GetCall[] = [];
  rpcs: RpcCall[] = [];
  constructor(
    private readonly statusByIp: Record<string, unknown> = {},
    private readonly rpcByMethod: Record<string, unknown> = {},
  ) {}
  async get(ip: string, path: string): Promise<unknown> {
    this.gets.push({ ip, path });
    if (path === '/status') return this.statusByIp[ip] ?? {};
    return { ok: true };
  }
  async rpc(ip: string, body: unknown): Promise<unknown> {
    const b = body as { method: string; params: Record<string, unknown> };
    this.rpcs.push({ ip, body: b });
    return this.rpcByMethod[b.method] ?? {};
  }
}

describe('ShellyIotManager', () => {
  it('listDevices expone un device por canal (Gen1, Shelly 2.5)', async () => {
    const transport = new FakeTransport({
      '192.168.1.80': { relays: [{ ison: true }, { ison: false }], meters: [{ power: 10 }, { power: 0 }] },
    });
    const mgr = new ShellyIotManager({
      transport,
      devices: [{ ip: '192.168.1.80', name: 'Shelly 2.5', gen: 1, channels: 2 }],
    });
    const devices = await mgr.listDevices();
    expect(devices.map((d) => d.id)).toEqual(['shelly:192.168.1.80:0', 'shelly:192.168.1.80:1']);
  });

  it('setState Gen1 relé pega a /relay/<ch>?turn=on', async () => {
    const transport = new FakeTransport({ '192.168.1.80': { relays: [{ ison: false }], meters: [] } });
    const mgr = new ShellyIotManager({ transport, devices: [{ ip: '192.168.1.80', gen: 1, channels: 1 }] });
    await mgr.setState('shelly:192.168.1.80:0', { on: true });
    expect(transport.gets.some((g) => g.path === '/relay/0?turn=on')).toBe(true);
  });

  it('setState Gen2 relé emite Switch.Set por JSON-RPC', async () => {
    const transport = new FakeTransport({}, { 'Switch.GetStatus': { output: true, apower: 3 } });
    const mgr = new ShellyIotManager({ transport, devices: [{ ip: '192.168.1.82', gen: 2, channels: 1 }] });
    await mgr.setState('shelly:192.168.1.82:0', { on: true });
    const set = transport.rpcs.find((r) => r.body.method === 'Switch.Set');
    expect(set!.body.params).toMatchObject({ id: 0, on: true });
  });

  it('setState Gen2 luz (type=light) emite Light.Set con brillo', async () => {
    const transport = new FakeTransport({}, { 'Light.GetStatus': { output: true, brightness: 80 } });
    const mgr = new ShellyIotManager({
      transport,
      devices: [{ ip: '192.168.1.83', gen: 2, channels: 1, type: 'light' }],
    });
    await mgr.setState('shelly:192.168.1.83:0', { brightness: 80 });
    const set = transport.rpcs.find((r) => r.body.method === 'Light.Set');
    expect(set!.body.params).toMatchObject({ id: 0, brightness: 80 });
  });

  it('multi-canal: getDevice devuelve el canal correcto y lanza si el dispositivo no existe', async () => {
    const transport = new FakeTransport({
      '192.168.1.80': { relays: [{ ison: true }, { ison: false }], meters: [] },
    });
    const mgr = new ShellyIotManager({ transport, devices: [{ ip: '192.168.1.80', gen: 1, channels: 2 }] });
    expect(await mgr.getDevice('shelly:192.168.1.80:1')).toMatchObject({ on: false });
    await expect(mgr.setState('shelly:10.0.0.1:0', { on: true })).rejects.toThrow(/no encontrado/i);
  });
});
