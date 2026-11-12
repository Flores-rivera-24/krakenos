import { describe, expect, it } from 'vitest';
import { KasaIotManager } from '../../src/iot/kasa.iot.js';
import type { KasaDiscovered, KasaTransport, TapoTransport } from '../../src/iot/kasa.transport.js';

function plugSysinfo(alias: string, on: boolean) {
  return {
    system: { get_sysinfo: { alias, mic_type: 'IOT.SMARTPLUGSWITCH', relay_state: on ? 1 : 0 } },
  };
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
  discoverCalls = 0;
  constructor(
    private readonly discovered: KasaDiscovered[],
    private readonly sysinfoByIp: Record<string, unknown> = {},
  ) {}
  async discover(): Promise<KasaDiscovered[]> {
    this.discoverCalls++;
    return this.discovered;
  }
  async send(ip: string, commandJson: string): Promise<unknown> {
    this.sent.push({ ip, cmd: commandJson });
    return this.sysinfoByIp[ip] ?? null;
  }
}

class FakeTapo implements TapoTransport {
  requests: { ip: string; method: string; params?: Record<string, unknown> }[] = [];
  discoverCalls = 0;
  constructor(
    private readonly ips: string[],
    private readonly infoByIp: Record<string, unknown> = {},
  ) {}
  async discover(): Promise<string[]> {
    this.discoverCalls++;
    return this.ips;
  }
  async request(ip: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ ip, method, params });
    return this.infoByIp[ip] ?? { result: {} };
  }
}

const tapoInfo = (model: string, on: boolean) => ({
  result: {
    model,
    nickname: Buffer.from('Tapo dev').toString('base64'),
    device_on: on,
    brightness: 50,
  },
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
    const mgr = new KasaIotManager({ kasa, kasaIps: ['192.168.1.60'] });
    await mgr.setState('kasa:192.168.1.60', { on: true });
    expect(
      kasa.sent.some((s) => s.cmd.includes('set_relay_state') && s.cmd.includes('"state":1')),
    ).toBe(true);
  });

  it('setState en una bombilla Kasa usa transition_light_state con el brillo', async () => {
    const kasa = new FakeKasa([], { '192.168.1.61': bulbSysinfo('Luz', true, 30) });
    const mgr = new KasaIotManager({ kasa, kasaIps: ['192.168.1.61'] });
    await mgr.setState('kasa:192.168.1.61', { brightness: 75 });
    const cmd = kasa.sent.find((s) => s.cmd.includes('transition_light_state'));
    expect(cmd).toBeDefined();
    expect(cmd!.cmd).toContain('"brightness":75');
  });

  it('setState enruta a Tapo por el prefijo tapo: y emite set_device_info', async () => {
    const tapo = new FakeTapo([], { '192.168.1.70': tapoInfo('P115', true) });
    const mgr = new KasaIotManager({ kasa: new FakeKasa([]), tapo, tapoIps: ['192.168.1.70'] });
    await mgr.setState('tapo:192.168.1.70', { on: false });
    expect(
      tapo.requests.some((r) => r.method === 'set_device_info' && r.params?.device_on === false),
    ).toBe(true);
  });

  it('getDevice devuelve null para un prefijo desconocido y consulta el correcto', async () => {
    const kasa = new FakeKasa([], { '192.168.1.60': plugSysinfo('Cafetera', true) });
    const mgr = new KasaIotManager({ kasa, kasaIps: ['192.168.1.60'] });
    expect(await mgr.getDevice('zigbee:abc')).toBeNull();
    expect(await mgr.getDevice('kasa:192.168.1.60')).toMatchObject({
      id: 'kasa:192.168.1.60',
      on: true,
    });
  });

  describe('ids de aparato: solo valen los hosts configurados o descubiertos de su familia', () => {
    const rechazados = [
      'kasa:example.com',
      'kasa:8.8.8.8',
      'kasa:169.254.169.254',
      'kasa:127.0.0.1',
      'kasa:',
      'tapo:192.168.1.20',
      'kasa:10.0.0.5:9999',
      'tapo:8.8.8.8',
    ];
    const sysinfo = {
      '192.168.1.20': plugSysinfo('A', false),
      'enchufe-sala.lan': plugSysinfo('B', false),
    };

    it('acepta los hosts Kasa configurados (IP y nombre) al leer y al cambiar', async () => {
      const kasa = new FakeKasa([], sysinfo);
      const mgr = new KasaIotManager({
        kasa,
        tapo: new FakeTapo([]),
        kasaIps: ['192.168.1.20', 'enchufe-sala.lan'],
      });
      for (const id of ['kasa:192.168.1.20', 'kasa:enchufe-sala.lan']) {
        expect(await mgr.getDevice(id)).toMatchObject({ id });
        expect(await mgr.setState(id, { on: true })).toMatchObject({ id });
      }
    });

    it.each(rechazados)('rechaza %s como desconocido y no abre conexión', async (id) => {
      const kasa = new FakeKasa([], sysinfo);
      const tapo = new FakeTapo([]);
      const mgr = new KasaIotManager({
        kasa,
        tapo,
        kasaIps: ['192.168.1.20', 'enchufe-sala.lan'],
      });
      expect(await mgr.getDevice(id)).toBeNull();
      await expect(mgr.setState(id, { on: true })).rejects.toMatchObject({
        code: 'IOT_NOT_FOUND',
      });
      expect(kasa.sent).toEqual([]);
      expect(tapo.requests).toEqual([]);
    });

    it('sin ningún host configurado, cualquier id rechaza', async () => {
      const kasa = new FakeKasa([], sysinfo);
      const tapo = new FakeTapo([]);
      const mgr = new KasaIotManager({ kasa, tapo });
      for (const id of ['kasa:192.168.1.20', 'tapo:192.168.1.20']) {
        expect(await mgr.getDevice(id)).toBeNull();
        await expect(mgr.setState(id, { on: true })).rejects.toMatchObject({
          code: 'IOT_NOT_FOUND',
        });
      }
      expect(kasa.sent).toEqual([]);
      expect(tapo.requests).toEqual([]);
    });

    it('operar sobre un host descubierto no visto en listDevices no lanza discover ni abre conexión', async () => {
      const kasa = new FakeKasa(
        [{ ip: '192.168.1.20', sysinfo: sysinfo['192.168.1.20'] }],
        sysinfo,
      );
      const tapo = new FakeTapo(['192.168.1.30']);
      const mgr = new KasaIotManager({ kasa, tapo });
      expect(await mgr.getDevice('kasa:192.168.1.20')).toBeNull();
      await expect(mgr.setState('tapo:192.168.1.30', { on: true })).rejects.toMatchObject({
        code: 'IOT_NOT_FOUND',
      });
      expect(kasa.discoverCalls + tapo.discoverCalls).toBe(0);
      expect(kasa.sent).toEqual([]);
      expect(tapo.requests).toEqual([]);
    });

    it('un host privado descubierto, tras listDevices, se puede operar sin otro discover', async () => {
      const kasa = new FakeKasa(
        [{ ip: '192.168.1.20', sysinfo: sysinfo['192.168.1.20'] }],
        sysinfo,
      );
      const tapo = new FakeTapo(['192.168.1.30'], { '192.168.1.30': tapoInfo('P115', true) });
      const mgr = new KasaIotManager({ kasa, tapo });
      await mgr.listDevices();
      const antes = kasa.discoverCalls + tapo.discoverCalls;
      expect(await mgr.getDevice('kasa:192.168.1.20')).toMatchObject({ id: 'kasa:192.168.1.20' });
      expect(await mgr.setState('tapo:192.168.1.30', { on: false })).toMatchObject({
        id: 'tapo:192.168.1.30',
      });
      expect(kasa.discoverCalls + tapo.discoverCalls).toBe(antes);
    });

    it('un host descubierto con IP pública no entra en la lista de conocidos', async () => {
      const pub = plugSysinfo('X', false);
      const kasa = new FakeKasa([{ ip: '8.8.8.8', sysinfo: pub }], { '8.8.8.8': pub });
      const tapo = new FakeTapo(['1.1.1.1'], { '1.1.1.1': tapoInfo('P115', true) });
      const mgr = new KasaIotManager({ kasa, tapo });
      await mgr.listDevices();
      kasa.sent = [];
      tapo.requests = [];
      expect(await mgr.getDevice('kasa:8.8.8.8')).toBeNull();
      await expect(mgr.setState('tapo:1.1.1.1', { on: true })).rejects.toMatchObject({
        code: 'IOT_NOT_FOUND',
      });
      expect(kasa.sent).toEqual([]);
      expect(tapo.requests).toEqual([]);
    });
  });
});
