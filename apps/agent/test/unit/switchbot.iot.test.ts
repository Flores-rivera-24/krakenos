import { describe, expect, it } from 'vitest';
import { SwitchBotIotManager } from '../../src/iot/switchbot.iot.js';
import type { SwitchBotTransport } from '../../src/iot/switchbot.transport.js';

interface PostCall {
  path: string;
  body: unknown;
}

class FakeTransport implements SwitchBotTransport {
  posts: PostCall[] = [];
  gets: string[] = [];
  constructor(private readonly responses: Record<string, unknown> = {}) {}
  async get(path: string): Promise<unknown> {
    this.gets.push(path);
    return this.responses[path] ?? {};
  }
  async post(path: string, body: unknown): Promise<unknown> {
    this.posts.push({ path, body });
    return {};
  }
}

const DEVICE_LIST = {
  '/v1.0/devices': {
    deviceList: [
      { deviceId: 'AA1', deviceName: 'Enchufe', deviceType: 'Plug Mini (US)' },
      { deviceId: 'CC3', deviceName: 'Termómetro', deviceType: 'Meter' },
    ],
  },
};

describe('SwitchBotIotManager', () => {
  it('listDevices consulta /v1.0/devices y filtra los soportados', async () => {
    const transport = new FakeTransport(DEVICE_LIST);
    const devices = await new SwitchBotIotManager({ transport }).listDevices();
    expect(devices.map((d) => d.id)).toEqual(['switchbot:AA1']);
  });

  it('getDevice consulta el status y lo parsea', async () => {
    const transport = new FakeTransport({
      '/v1.0/devices/AA1/status': { deviceId: 'AA1', deviceType: 'Plug Mini (US)', power: 'on' },
    });
    const dev = await new SwitchBotIotManager({ transport }).getDevice('switchbot:AA1');
    expect(dev).toMatchObject({ id: 'switchbot:AA1', on: true, kind: 'plug' });
  });

  it('setState postea el comando turnOn a /commands con el body correcto', async () => {
    const transport = new FakeTransport({
      '/v1.0/devices/AA1/status': { deviceId: 'AA1', deviceType: 'Plug Mini (US)', power: 'on' },
    });
    await new SwitchBotIotManager({ transport }).setState('switchbot:AA1', { on: true });
    expect(transport.posts).toEqual([
      { path: '/v1.0/devices/AA1/commands', body: { command: 'turnOn', parameter: 'default', commandType: 'command' } },
    ]);
  });

  it('setState de una bombilla envía setBrightness y setColor', async () => {
    const transport = new FakeTransport({
      '/v1.0/devices/BB2/status': { deviceId: 'BB2', deviceType: 'Color Bulb', power: 'on', brightness: 50 },
    });
    await new SwitchBotIotManager({ transport }).setState('switchbot:BB2', {
      brightness: 80,
      color: { hex: '#00ff00' },
    });
    expect(transport.posts.map((p) => (p.body as { command: string }).command)).toEqual([
      'setBrightness',
      'setColor',
    ]);
  });

  it('getDevice devuelve null para un id inválido y setState lanza', async () => {
    const mgr = new SwitchBotIotManager({ transport: new FakeTransport() });
    expect(await mgr.getDevice('switchbot:')).toBeNull();
    await expect(mgr.setState('switchbot:', { on: true })).rejects.toThrow(/no encontrado/i);
  });
});
