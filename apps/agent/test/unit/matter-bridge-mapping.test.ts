import type { IotDevice } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  endpointTypeFor,
  hueSatToHex,
  levelToPercent,
  matterCommandToState,
  miredsToKelvin,
  percentToLevel,
  toBridgeEndpoint,
} from '../../src/iot/matter-bridge/mapping.js';

function device(over: Partial<IotDevice>): IotDevice {
  return {
    id: 'x',
    name: 'X',
    kind: 'light',
    room: null,
    reachable: true,
    on: true,
    brightness: 50,
    color: null,
    readings: [],
    ...over,
  };
}

describe('matter-bridge mapping (US-171)', () => {
  describe('endpointTypeFor', () => {
    it('enchufe → onoff', () => {
      expect(endpointTypeFor(device({ kind: 'plug', brightness: null }))).toBe('onoff');
    });
    it('luz con color → color', () => {
      expect(endpointTypeFor(device({ color: { hex: '#fff', temperatureK: null } }))).toBe('color');
    });
    it('luz con brillo → dimmable', () => {
      expect(endpointTypeFor(device({ brightness: 80, color: null }))).toBe('dimmable');
    });
    it('luz sin brillo → onoff', () => {
      expect(endpointTypeFor(device({ brightness: null, color: null }))).toBe('onoff');
    });
    it('sensor → null (no se expone)', () => {
      expect(
        endpointTypeFor(device({ kind: 'sensor', on: null, brightness: null })),
      ).toBeNull();
    });
  });

  it('toBridgeEndpoint omite lo no mapeable', () => {
    expect(toBridgeEndpoint(device({ kind: 'sensor', on: null, brightness: null }))).toBeNull();
    expect(toBridgeEndpoint(device({ kind: 'plug', brightness: null }))).toMatchObject({
      deviceId: 'x',
      type: 'onoff',
    });
  });

  describe('conversiones', () => {
    it('nivel Matter ↔ porcentaje', () => {
      expect(levelToPercent(254)).toBe(100);
      expect(levelToPercent(0)).toBe(0);
      expect(percentToLevel(100)).toBe(254);
      expect(percentToLevel(50)).toBe(127);
    });
    it('mireds → kelvin', () => {
      expect(miredsToKelvin(370)).toBe(2703); // ~2700K cálido
      expect(miredsToKelvin(0)).toBe(0);
    });
    it('hue/sat → hex rojo saturado', () => {
      expect(hueSatToHex(0, 254)).toBe('#ff0000');
    });
  });

  describe('matterCommandToState', () => {
    it('on/off', () => {
      expect(matterCommandToState({ on: false })).toEqual({ on: false });
    });
    it('nivel → brillo', () => {
      expect(matterCommandToState({ level: 254 })).toEqual({ brightness: 100 });
    });
    it('temperatura de color (mireds) → kelvin', () => {
      expect(matterCommandToState({ colorTempMireds: 250 })).toEqual({
        color: { temperatureK: 4000 },
      });
    });
    it('hue/sat → hex', () => {
      expect(matterCommandToState({ hue: 0, saturation: 254 })).toEqual({
        color: { hex: '#ff0000' },
      });
    });
    it('comando vacío → null', () => {
      expect(matterCommandToState({})).toBeNull();
    });
  });
});
