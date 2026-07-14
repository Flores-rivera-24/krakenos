import { describe, expect, it } from 'vitest';
import {
  buildDiscoveryConfigs,
  buildStateMessages,
  commandFilters,
  exposureFor,
  hexToRgb,
  parseInboundCommand,
  rgbToHex,
  type SnapshotIotDevice,
  type StateSnapshot,
} from '../../src/modules/interop/ha-discovery.js';

const plug: SnapshotIotDevice = { id: 'plug-1', name: 'Enchufe', kind: 'plug', on: false, brightness: null, color: null, powerW: 12 };
const dimLight: SnapshotIotDevice = { id: 'luz', name: 'Luz', kind: 'light', on: true, brightness: 60, color: null };
const colorLight: SnapshotIotDevice = { id: 'tira', name: 'Tira', kind: 'light', on: true, brightness: 100, color: { hex: '#ff8800', temperatureK: null } };
const sensor: SnapshotIotDevice = { id: 's1', name: 'Sensor', kind: 'sensor', on: null, brightness: null, color: null };

const snap: StateSnapshot = {
  iot: [plug, dimLight, colorLight, sensor],
  energy: { todayKwh: 2.5, todayCost: 0.75, currency: '€' },
  devicesOnline: 7,
  homeMode: 'away',
  alarmPhase: 'armed',
};

describe('exposureFor (US-213)', () => {
  it('plug → switch; sensor → null', () => {
    expect(exposureFor(plug, true)).toEqual({ component: 'switch', controllable: true });
    expect(exposureFor(sensor, true)).toBeNull();
  });
  it('light es entidad light SOLO con control activo (HA exige command_topic)', () => {
    expect(exposureFor(dimLight, true)).toEqual({ component: 'light', brightness: true, color: false });
    expect(exposureFor(colorLight, true)).toEqual({ component: 'light', brightness: true, color: true });
    // Sin control, la luz se muestra como switch de solo lectura.
    expect(exposureFor(dimLight, false)).toEqual({ component: 'switch', controllable: false });
  });
});

describe('buildDiscoveryConfigs (US-213)', () => {
  it('publica switch/light/sensores con topics HA correctos', () => {
    const msgs = buildDiscoveryConfigs(snap, 'casa', true);
    const byTopic = new Map(msgs.map((m) => [m.topic, JSON.parse(m.payload || '{}')]));
    expect(byTopic.has('homeassistant/switch/krakenos/iot_plug-1/config')).toBe(true);
    expect(byTopic.has('homeassistant/light/krakenos/iot_luz/config')).toBe(true);
    // El light con color declara rgb; el dimmable, brillo.
    const tira = byTopic.get('homeassistant/light/krakenos/iot_tira/config');
    expect(tira.rgb_command_topic).toBe('casa/iot/tira/rgb/set');
    expect(tira.brightness_scale).toBe(100);
    // Sensores del hub.
    expect(byTopic.get('homeassistant/sensor/krakenos/home_mode/config').state_topic).toBe('casa/home/mode');
    expect(byTopic.get('homeassistant/sensor/krakenos/alarm/config')).toBeDefined();
    expect(byTopic.get('homeassistant/sensor/krakenos/energy_today/config').device_class).toBe('energy');
    // Sensor de potencia del enchufe (mide powerW).
    expect(byTopic.has('homeassistant/sensor/krakenos/iot_plug-1_power/config')).toBe(true);
  });

  it('sin control: la luz cae a switch de solo lectura (sin command_topic)', () => {
    const msgs = buildDiscoveryConfigs(snap, 'casa', false);
    const luz = msgs.find((m) => m.topic === 'homeassistant/switch/krakenos/iot_luz/config');
    expect(luz).toBeDefined();
    expect(JSON.parse(luz!.payload).command_topic).toBeUndefined();
  });

  it('un sensor puro no genera entidad on/off', () => {
    const msgs = buildDiscoveryConfigs({ ...snap, iot: [sensor] }, 'casa', true);
    expect(msgs.some((m) => m.topic.includes('iot_s1/config'))).toBe(false);
  });
});

describe('buildStateMessages (US-213)', () => {
  it('publica estado ON/OFF, brillo, rgb, potencia, modo y alarma; todo retained', () => {
    const msgs = buildStateMessages(snap, 'casa');
    const byTopic = new Map(msgs.map((m) => [m.topic, m.payload]));
    expect(byTopic.get('casa/iot/plug-1/state')).toBe('OFF');
    expect(byTopic.get('casa/iot/luz/state')).toBe('ON');
    expect(byTopic.get('casa/iot/luz/brightness')).toBe('60');
    expect(byTopic.get('casa/iot/tira/rgb')).toBe('255,136,0');
    expect(byTopic.get('casa/iot/plug-1/power')).toBe('12');
    expect(byTopic.get('casa/home/mode')).toBe('away');
    expect(byTopic.get('casa/alarm/state')).toBe('armed');
    expect(msgs.every((m) => m.retain)).toBe(true);
  });

  it('no filtra personas ni PII', () => {
    const all = buildStateMessages(snap, 'casa').map((m) => `${m.topic} ${m.payload}`).join('\n');
    expect(all).not.toMatch(/person|displayName|mac|192\.168/i);
  });
});

describe('parseInboundCommand (US-213)', () => {
  it('interpreta ON/OFF, brillo y rgb', () => {
    expect(parseInboundCommand('casa/iot/plug-1/set', 'ON', 'casa')).toEqual({ deviceId: 'plug-1', state: { on: true } });
    expect(parseInboundCommand('casa/iot/plug-1/set', 'off', 'casa')).toEqual({ deviceId: 'plug-1', state: { on: false } });
    expect(parseInboundCommand('casa/iot/luz/brightness/set', '55', 'casa')).toEqual({ deviceId: 'luz', state: { brightness: 55 } });
    expect(parseInboundCommand('casa/iot/tira/rgb/set', '255,136,0', 'casa')).toEqual({ deviceId: 'tira', state: { color: { hex: '#ff8800' } } });
  });
  it('ignora topics ajenos y payloads basura (no lanza)', () => {
    expect(parseInboundCommand('otro/iot/x/set', 'ON', 'casa')).toBeNull();
    expect(parseInboundCommand('casa/iot/x/set', 'meh', 'casa')).toBeNull();
    expect(parseInboundCommand('casa/iot/x/brightness/set', 'NaN', 'casa')).toBeNull();
    expect(parseInboundCommand('casa/status', 'online', 'casa')).toBeNull();
  });
  it('acota el brillo a 0-100', () => {
    expect(parseInboundCommand('casa/iot/luz/brightness/set', '999', 'casa')).toEqual({ deviceId: 'luz', state: { brightness: 100 } });
  });
});

describe('conversiones de color', () => {
  it('hex↔rgb ida y vuelta', () => {
    expect(hexToRgb('#ff8800')).toBe('255,136,0');
    expect(rgbToHex('255,136,0')).toBe('#ff8800');
    expect(rgbToHex('300,0,0')).toBeNull();
    expect(hexToRgb('basura')).toBe('0,0,0');
  });
});

describe('commandFilters', () => {
  it('cubre set, brightness y rgb', () => {
    expect(commandFilters('casa')).toEqual(['casa/iot/+/set', 'casa/iot/+/brightness/set', 'casa/iot/+/rgb/set']);
  });
});
