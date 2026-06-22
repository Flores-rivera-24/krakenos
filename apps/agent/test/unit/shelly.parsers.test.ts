import { describe, expect, it } from 'vitest';
import {
  gen1LightPath,
  gen1RelayPath,
  gen2LightSet,
  gen2SwitchGetStatus,
  gen2SwitchSet,
  parseGen1Status,
  parseGen2Channel,
  parseShellyId,
} from '../../src/iot/shelly.parsers.js';

describe('shelly.parsers', () => {
  it('gen1RelayPath y gen1LightPath construyen la ruta REST correcta', () => {
    expect(gen1RelayPath(0, true)).toBe('/relay/0?turn=on');
    expect(gen1RelayPath(1, false)).toBe('/relay/1?turn=off');
    expect(gen1LightPath(0, { on: true, brightness: 50 })).toBe('/light/0?turn=on&brightness=50');
  });

  it('gen2SwitchSet/GetStatus y gen2LightSet construyen el JSON-RPC correcto', () => {
    expect(gen2SwitchSet(0, true)).toMatchObject({ method: 'Switch.Set', params: { id: 0, on: true } });
    expect(gen2SwitchGetStatus(1)).toMatchObject({ method: 'Switch.GetStatus', params: { id: 1 } });
    expect(gen2LightSet(0, { on: true, brightness: 30 })).toMatchObject({
      method: 'Light.Set',
      params: { id: 0, on: true, brightness: 30 },
    });
  });

  it('parseGen1Status mapea un Shelly 2.5 (2 relés) a 2 IotDevice con potencia', () => {
    const status = {
      relays: [{ ison: true }, { ison: false }],
      meters: [{ power: 12.34 }, { power: 0 }],
    };
    const devices = parseGen1Status({ ip: '192.168.1.80', name: 'Shelly 2.5', gen: 1, channels: 2 }, status);
    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({ id: 'shelly:192.168.1.80:0', kind: 'plug', on: true });
    expect(devices[0]!.reading).toEqual({ metric: 'potencia', value: 12.3, unit: 'W' });
    expect(devices[1]).toMatchObject({ id: 'shelly:192.168.1.80:1', on: false });
  });

  it('parseGen1Status mapea un dimmer (type=light) con brillo', () => {
    const status = { lights: [{ ison: true, brightness: 65 }], meters: [{ power: 5 }] };
    const devices = parseGen1Status({ ip: '192.168.1.81', gen: 1, channels: 1, type: 'light' }, status);
    expect(devices[0]).toMatchObject({ kind: 'light', on: true, brightness: 65 });
  });

  it('parseGen2Channel mapea output/apower/brightness', () => {
    const plug = parseGen2Channel({ ip: '192.168.1.82', gen: 2, type: 'relay' }, 0, { output: true, apower: 7.7 });
    expect(plug).toMatchObject({ id: 'shelly:192.168.1.82:0', kind: 'plug', on: true });
    expect(plug.reading).toEqual({ metric: 'potencia', value: 7.7, unit: 'W' });

    const light = parseGen2Channel({ ip: '192.168.1.83', gen: 2, type: 'light' }, 0, { output: false, brightness: 40 });
    expect(light).toMatchObject({ kind: 'light', on: false, brightness: 40 });
  });

  it('parseShellyId separa ip y canal (con y sin prefijo)', () => {
    expect(parseShellyId('shelly:192.168.1.80:1')).toEqual({ ip: '192.168.1.80', channel: 1 });
    expect(parseShellyId('192.168.1.80:0')).toEqual({ ip: '192.168.1.80', channel: 0 });
    expect(parseShellyId('sinpuerto')).toBeNull();
  });
});
