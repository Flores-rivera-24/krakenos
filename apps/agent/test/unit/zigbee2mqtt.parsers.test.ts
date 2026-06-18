import { describe, expect, it } from 'vitest';
import { topicMatches } from '../../src/iot/mqtt.transport.js';
import {
  brightnessFromZigbee,
  brightnessToZigbee,
  buildSetPayload,
  inferKind,
  parseBridgeDevices,
  parseDeviceState,
} from '../../src/iot/zigbee2mqtt.parsers.js';

describe('topicMatches', () => {
  it('soporta + (un nivel) y # (resto)', () => {
    expect(topicMatches('zigbee2mqtt/+', 'zigbee2mqtt/luz')).toBe(true);
    expect(topicMatches('zigbee2mqtt/+', 'zigbee2mqtt/luz/availability')).toBe(false);
    expect(topicMatches('zigbee2mqtt/+/availability', 'zigbee2mqtt/luz/availability')).toBe(true);
    expect(topicMatches('zigbee2mqtt/bridge/devices', 'zigbee2mqtt/bridge/devices')).toBe(true);
    expect(topicMatches('zigbee2mqtt/#', 'zigbee2mqtt/bridge/devices')).toBe(true);
  });
});

describe('escalado de brillo', () => {
  it('convierte 0-100 ↔ 0-254', () => {
    expect(brightnessToZigbee(100)).toBe(254);
    expect(brightnessToZigbee(0)).toBe(0);
    expect(brightnessFromZigbee(254)).toBe(100);
    expect(brightnessFromZigbee(127)).toBe(50);
  });
});

describe('inferKind', () => {
  it('clasifica luz, enchufe y sensor por los exposes', () => {
    expect(inferKind([{ type: 'light', features: [{ name: 'state' }, { name: 'brightness' }] }])).toBe('light');
    expect(inferKind([{ type: 'switch', features: [{ name: 'state' }] }])).toBe('plug');
    expect(inferKind([{ name: 'temperature' }, { name: 'humidity' }])).toBe('sensor');
  });
});

describe('parseBridgeDevices', () => {
  it('mapea friendly_name y descarta el coordinador', () => {
    const metas = parseBridgeDevices([
      { type: 'Coordinator', friendly_name: 'Coordinator' },
      { type: 'Router', friendly_name: 'luz_salon', definition: { exposes: [{ type: 'light', features: [{ name: 'brightness' }] }] } },
      { type: 'EndDevice', friendly_name: 'sensor_temp', definition: { exposes: [{ name: 'temperature' }] } },
      { type: 'EndDevice' }, // sin friendly_name
    ]);
    expect(metas).toEqual([
      { id: 'luz_salon', name: 'luz_salon', kind: 'light' },
      { id: 'sensor_temp', name: 'sensor_temp', kind: 'sensor' },
    ]);
  });
});

describe('parseDeviceState', () => {
  it('mapea state/brightness y lecturas de sensor', () => {
    expect(parseDeviceState({ state: 'ON', brightness: 254 })).toEqual({ on: true, brightness: 100, reading: null });
    expect(parseDeviceState({ state: 'OFF' })).toEqual({ on: false, brightness: null, reading: null });
    expect(parseDeviceState({ temperature: 21.5 })).toEqual({
      on: null,
      brightness: null,
      reading: { metric: 'temperatura', value: 21.5, unit: '°C' },
    });
  });
});

describe('buildSetPayload', () => {
  it('construye el set de encendido/apagado', () => {
    expect(JSON.parse(buildSetPayload({ on: true }, 'plug'))).toEqual({ state: 'ON' });
    expect(JSON.parse(buildSetPayload({ on: false }, 'light'))).toEqual({ state: 'OFF' });
  });

  it('escala el brillo y enciende la luz si no se indica on; ignora brillo en plug', () => {
    expect(JSON.parse(buildSetPayload({ brightness: 50 }, 'light'))).toEqual({ brightness: 127, state: 'ON' });
    expect(JSON.parse(buildSetPayload({ brightness: 50 }, 'plug'))).toEqual({});
  });
});
