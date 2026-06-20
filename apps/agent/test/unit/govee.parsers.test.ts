import { describe, expect, it } from 'vitest';
import {
  buildBrightness,
  buildColorRgb,
  buildColorTemp,
  buildScan,
  buildTurn,
  goveeToIotDevice,
  hexToRgb,
  parseGoveeMessage,
  rgbToHex,
} from '../../src/iot/govee.parsers.js';

describe('builders de comandos Govee', () => {
  it('scan / turn / brightness', () => {
    expect(JSON.parse(buildScan())).toEqual({ msg: { cmd: 'scan', data: { account_topic: 'reserve' } } });
    expect(JSON.parse(buildTurn(true))).toEqual({ msg: { cmd: 'turn', data: { value: 1 } } });
    expect(JSON.parse(buildBrightness(150))).toEqual({ msg: { cmd: 'brightness', data: { value: 100 } } });
  });

  it('color RGB y temperatura usan colorwc', () => {
    expect(JSON.parse(buildColorRgb('#ff8800'))).toEqual({
      msg: { cmd: 'colorwc', data: { color: { r: 255, g: 136, b: 0 }, colorTemInKelvin: 0 } },
    });
    expect(JSON.parse(buildColorTemp(2700))).toEqual({
      msg: { cmd: 'colorwc', data: { color: { r: 0, g: 0, b: 0 }, colorTemInKelvin: 2700 } },
    });
  });
});

describe('hex ↔ rgb', () => {
  it('convierte en ambos sentidos', () => {
    expect(hexToRgb('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    expect(rgbToHex({ r: 255, g: 136, b: 0 })).toBe('#ff8800');
    expect(hexToRgb('nope')).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('parseGoveeMessage', () => {
  it('extrae cmd/data y tolera basura', () => {
    expect(parseGoveeMessage('{"msg":{"cmd":"scan","data":{"ip":"10.0.0.5"}}}')).toEqual({
      cmd: 'scan',
      data: { ip: '10.0.0.5' },
    });
    expect(parseGoveeMessage('no-json')).toBeNull();
    expect(parseGoveeMessage('{"foo":1}')).toBeNull();
  });
});

describe('goveeToIotDevice', () => {
  it('mapea on/brillo/color (rgb) y la temperatura', () => {
    expect(
      goveeToIotDevice({ id: 'AA:BB', ip: '10.0.0.5', sku: 'H6159', state: { onOff: 1, brightness: 80, color: { r: 255, g: 0, b: 0 }, colorTemInKelvin: 0 } }),
    ).toMatchObject({ id: 'AA:BB', name: 'Govee H6159', kind: 'light', on: true, brightness: 80, color: { hex: '#ff0000', temperatureK: null } });

    expect(
      goveeToIotDevice({ id: 'CC', ip: '10.0.0.6', sku: null, state: { onOff: 0, colorTemInKelvin: 4000 } }).color,
    ).toEqual({ hex: null, temperatureK: 4000 });
  });

  it('sin estado: luz con color por defecto y campos nulos', () => {
    const d = goveeToIotDevice({ id: 'X', ip: '10.0.0.7', sku: null, state: null });
    expect(d).toMatchObject({ on: null, brightness: null, color: { hex: '#ffffff', temperatureK: null } });
  });
});
