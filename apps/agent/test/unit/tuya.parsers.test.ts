import { describe, expect, it } from 'vitest';
import {
  dpsToIotDevice,
  scaleBrightnessFromDps,
  scaleBrightnessToDps,
  stateToTuyaPayload,
} from '../../src/iot/tuya.parsers.js';
import type { TuyaDeviceConfig } from '../../src/iot/tuya.store.js';

const CONFIG: TuyaDeviceConfig = {
  deviceId: 'dev-1',
  localKey: 'abcdef0123456789',
  ip: '192.168.1.80',
  name: 'Foco salón',
};

describe('tuya.parsers — escalado de brillo', () => {
  it('scaleBrightnessToDps: 0 → 10 y 100 → 1000', () => {
    expect(scaleBrightnessToDps(0)).toBe(10);
    expect(scaleBrightnessToDps(100)).toBe(1000);
  });

  it('scaleBrightnessFromDps: 500 → 50', () => {
    expect(scaleBrightnessFromDps(500)).toBe(50);
  });
});

describe('tuya.parsers — dpsToIotDevice', () => {
  it('mapea DPS 20+22 (esquema nuevo) a un IotDevice de luz alcanzable', () => {
    const device = dpsToIotDevice(CONFIG, { '20': true, '22': 1000 });
    expect(device).toMatchObject({
      id: 'dev-1',
      name: 'Foco salón',
      kind: 'light',
      reachable: true,
      on: true,
      brightness: 100,
      color: null,
      reading: null,
    });
  });

  it('soporta también el esquema viejo (DPS 1+2)', () => {
    const device = dpsToIotDevice(CONFIG, { '1': false, '2': 500 });
    expect(device).toMatchObject({ on: false, brightness: 50 });
  });
});

describe('tuya.parsers — stateToTuyaPayload', () => {
  it('construye el payload parcial nuevo (20/22) escalando el brillo', () => {
    expect(stateToTuyaPayload({ on: true, brightness: 50 })).toEqual({ '20': true, '22': 505 });
  });
});
