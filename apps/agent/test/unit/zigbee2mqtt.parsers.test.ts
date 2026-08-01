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
  const vacio = { readings: [], position: null, targetC: null, locked: null };

  it('mapea state/brightness', () => {
    expect(parseDeviceState({ state: 'ON', brightness: 254 })).toEqual({
      on: true,
      brightness: 100,
      ...vacio,
    });
    expect(parseDeviceState({ state: 'OFF' })).toEqual({ on: false, brightness: null, ...vacio });
  });

  it('acumula TODAS las lecturas, no solo la primera (US-244)', () => {
    // El parser viejo usaba `else if`, así que este mensaje —el de un sensor de
    // clima cualquiera— perdía la humedad y la batería sin avisar.
    const state = parseDeviceState({ temperature: 21.5, humidity: 45, battery: 88 });
    expect(state.readings).toEqual([
      { metric: 'temperature', value: 21.5, unit: '°C' },
      { metric: 'humidity', value: 45, unit: '%' },
      { metric: 'battery', value: 88, unit: '%' },
    ]);
  });

  it('⚠️ contact:true en z2m es CERRADO → se invierte a 0 (US-244)', () => {
    // Este es el bug que más caro habría salido: sin invertir, la alarma saltaría
    // al CERRAR la puerta y callaría al abrirla, funcionando al revés sin un solo
    // error en pantalla.
    expect(parseDeviceState({ contact: true }).readings).toEqual([
      { metric: 'contact', value: 0, unit: '' },
    ]);
    expect(parseDeviceState({ contact: false }).readings).toEqual([
      { metric: 'contact', value: 1, unit: '' },
    ]);
  });

  it('mapea presencia, humo y CO como sucesos 1/0', () => {
    expect(parseDeviceState({ occupancy: true }).readings).toEqual([
      { metric: 'occupancy', value: 1, unit: '' },
    ]);
    expect(parseDeviceState({ smoke: true }).readings).toEqual([
      { metric: 'smoke', value: 1, unit: '' },
    ]);
    expect(parseDeviceState({ carbon_monoxide: false }).readings).toEqual([
      { metric: 'co', value: 0, unit: '' },
    ]);
  });

  it('mapea persiana, termostato y cerradura', () => {
    expect(parseDeviceState({ position: 60 }).position).toBe(60);
    expect(parseDeviceState({ occupied_heating_setpoint: 21 }).targetC).toBe(21);
    expect(parseDeviceState({ lock_state: 'LOCK' }).locked).toBe(true);
    expect(parseDeviceState({ lock_state: 'UNLOCK' }).locked).toBe(false);
  });

  it('un mensaje sin nada reconocible no inventa lecturas', () => {
    expect(parseDeviceState({ linkquality: 120 }).readings).toEqual([]);
    expect(parseDeviceState(null).readings).toEqual([]);
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

  it('una persiana va por position, y su on se traduce a OPEN/CLOSE (US-244)', () => {
    expect(JSON.parse(buildSetPayload({ position: 60 }, 'cover'))).toEqual({ position: 60 });
    // `state: 'ON'` no significa nada para una persiana: su vocabulario es otro.
    expect(JSON.parse(buildSetPayload({ on: true }, 'cover'))).toEqual({ state: 'OPEN' });
    expect(JSON.parse(buildSetPayload({ on: false }, 'cover'))).toEqual({ state: 'CLOSE' });
    // Y el brillo no se le cuela.
    expect(JSON.parse(buildSetPayload({ position: 30, brightness: 50 }, 'cover'))).toEqual({
      position: 30,
    });
  });

  it('un termostato va por su setpoint', () => {
    expect(JSON.parse(buildSetPayload({ targetC: 21 }, 'climate'))).toEqual({
      occupied_heating_setpoint: 21,
    });
  });
});

describe('inferKind (US-244)', () => {
  const exposes = (...nodes: unknown[]) => nodes;

  it('clasifica las categorías nuevas', () => {
    expect(inferKind(exposes({ name: 'contact' }))).toBe('contact');
    expect(inferKind(exposes({ name: 'smoke' }))).toBe('smoke');
    expect(inferKind(exposes({ name: 'carbon_monoxide' }))).toBe('smoke');
    expect(inferKind(exposes({ type: 'cover' }))).toBe('cover');
    expect(inferKind(exposes({ name: 'position' }))).toBe('cover');
    expect(inferKind(exposes({ type: 'climate' }))).toBe('climate');
    expect(inferKind(exposes({ type: 'lock' }))).toBe('lock');
  });

  it('⚠️ una cerradura o una persiana NO se clasifican como enchufe', () => {
    // Las dos exponen `state` —con LOCK/UNLOCK y OPEN/CLOSE, no ON/OFF—, así que
    // con la comprobación de `switch` por delante acababan de `plug`: la UI les
    // pintaba un interruptor y se les mandaba `{"state":"ON"}`, que no entienden.
    expect(inferKind(exposes({ type: 'lock' }, { name: 'state' }))).toBe('lock');
    expect(inferKind(exposes({ type: 'cover' }, { name: 'state' }))).toBe('cover');
    // Y un enchufe de verdad sigue siendo un enchufe.
    expect(inferKind(exposes({ type: 'switch' }, { name: 'state' }))).toBe('plug');
  });

  it('lo que no encaja en nada cae a sensor', () => {
    expect(inferKind(exposes({ name: 'temperature' }))).toBe('sensor');
    expect(inferKind(undefined)).toBe('sensor');
  });
});
