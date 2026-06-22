import { describe, expect, it } from 'vitest';
import { KasaIotManager } from '../../src/iot/kasa.iot.js';
import type { KasaDiscovered, KasaTransport, TapoTransport } from '../../src/iot/kasa.transport.js';

function plugSysinfo(alias: string, on: boolean) {
  return { system: { get_sysinfo: { alias, mic_type: 'IOT.SMARTPLUGSWITCH', relay_state: on ? 1 : 0 } } };
}
function bulbSysinfo(alias: string, on: boolean, brightness: number) {
  return {
    system: {
      get_sysinfo: {
        alias,
        mic_type: 'IOT.SMARTBULB',
        is_color: 1,
        light_state: { on_off: on ? 1 : 0, brightness, color_temp: 0, hue: 0, saturation: 0 },
      },
    },
  };
}

class FakeKasa implements KasaTransport {
  sent: { ip: string; cmd: string }[] = [];
  constructor(
    private readonly discovered: KasaDiscovered[],
    private readonly sysinfoByIp: Record<string, unknown> = {},
  ) {}
  async discover(): Promise<KasaDiscovered[]> {
    return this.discovered;
  }
  async send(ip: string, commandJson: string): Promise<unknown> {
    this.sent.push({ ip, cmd: commandJson });
    return this.sysinfoByIp[ip] ?? null;
  }
}

class FakeTapo implements TapoTransport {
  requests: { ip: string; method: string; params?: Record<string, unknown> }[] = [];
  constructor(
    private readonly ips: string[],
    private readonly infoByIp: Record<string, unknown> = {},
  ) {}
  async discover(): Promise<string[]> {
    return this.ips;
  }
  async request(ip: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ ip, method, params });
    return this.infoByIp[ip] ?? { result: {} };
  }
}

const tapoInfo = (model: string, on: boolean) => ({
  result: { model, nickname: Buffer.from('Tapo dev').toString('base64'), device_on: on, brightness: 50 },
});

describe('KasaIotManager', () => {
  it('listDevices combina dispositivos Kasa (broadcast) y Tapo (config)', async () => {
    const kasa = new FakeKasa([{ ip: '192.168.1.60', sysinfo: plugSysinfo('Cafetera', true) }]);
    const tapo = new FakeTapo([], { '192.168.1.70': tapoInfo('L530', true) });
    const mgr = new KasaIotManager({ kasa, tapo, tapoIps: ['192.168.1.70'] });

    const devices = await mgr.listDevices();
    expect(devices.map((d) => d.id).sort()).toEqual(['kasa:192.168.1.60', 'tapo:192.168.1.70']);
  });

  it('listDevices sondea las IPs Kasa configuradas no descubiertas', async () => {
    const kasa = new FakeKasa([], { '192.168.1.65': plugSysinfo('Lámpara', false) });
    const mgr = new KasaIotManager({ kasa, kasaIps: ['192.168.1.65'] });
    const devices = await mgr.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: 'kasa:192.168.1.65', on: false });
  });

  it('setState enruta a Kasa por el prefijo kasa: y envía set_relay_state', async () => {
    const kasa = new FakeKasa([], { '192.168.1.60': plugSysinfo('Cafetera', false) });
    const mgr = new KasaIotManager({ kasa });
    await mgr.setState('kasa:192.168.1.60', { on: true });
    expect(kasa.sent.some((s) => s.cmd.includes('set_relay_state') && s.cmd.includes('"state":1'))).toBe(true);
  });

  it('setState en una bombilla Kasa usa transition_light_state con el brillo', async () => {
    const kasa = new FakeKasa([], { '192.168.1.61': bulbSysinfo('Luz', true, 30) });
    const mgr = new KasaIotManager({ kasa });
    await mgr.setState('kasa:192.168.1.61', { brightness: 75 });
    const cmd = kasa.sent.find((s) => s.cmd.includes('transition_light_state'));
    expect(cmd).toBeDefined();
    expect(cmd!.cmd).toContain('"brightness":75');
  });

  it('setState enruta a Tapo por el prefijo tapo: y emite set_device_info', async () => {
    const tapo = new FakeTapo([], { '192.168.1.70': tapoInfo('P115', true) });
    const mgr = new KasaIotManager({ kasa: new FakeKasa([]), tapo, tapoIps: ['192.168.1.70'] });
    await mgr.setState('tapo:192.168.1.70', { on: false });
    expect(tapo.requests.some((r) => r.method === 'set_device_info' && r.params?.device_on === false)).toBe(true);
  });

  it('getDevice devuelve null para un prefijo desconocido y consulta el correcto', async () => {
    const kasa = new FakeKasa([], { '192.168.1.60': plugSysinfo('Cafetera', true) });
    const mgr = new KasaIotManager({ kasa });
    expect(await mgr.getDevice('zigbee:abc')).toBeNull();
    expect(await mgr.getDevice('kasa:192.168.1.60')).toMatchObject({ id: 'kasa:192.168.1.60', on: true });
  });
});
