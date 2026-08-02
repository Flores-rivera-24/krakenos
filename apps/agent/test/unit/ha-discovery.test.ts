import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_OFFLINE,
  availabilityTopic,
  buildDiscoveryConfigs,
  buildStateMessages,
  commandFilters,
  exposureFor,
  hexToRgb,
  offlineMessage,
  parseInboundCommand,
  rgbToHex,
  willMessage,
  type ControlFlags,
  type SnapshotIotDevice,
  type StateSnapshot,
} from '../../src/modules/interop/ha-discovery.js';

const plug: SnapshotIotDevice = { id: 'plug-1', name: 'Enchufe', kind: 'plug', on: false, brightness: null, color: null, powerW: 12 };
const dimLight: SnapshotIotDevice = { id: 'luz', name: 'Luz', kind: 'light', on: true, brightness: 60, color: null };
const colorLight: SnapshotIotDevice = { id: 'tira', name: 'Tira', kind: 'light', on: true, brightness: 100, color: { hex: '#ff8800', temperatureK: null } };
const sensor: SnapshotIotDevice = { id: 's1', name: 'Sensor', kind: 'sensor', on: null, brightness: null, color: null };

const NADA: ControlFlags = { iot: false, pause: false };
const SOLO_IOT: ControlFlags = { iot: true, pause: false };
const TODO: ControlFlags = { iot: true, pause: true };

const snap: StateSnapshot = {
  iot: [plug, dimLight, colorLight, sensor],
  energy: { todayKwh: 2.5, todayCost: 0.75, currency: '€' },
  devicesOnline: 7,
  homeMode: 'away',
  alarmPhase: 'armed',
  blockedDevices: [
    { id: 'dev-abc', name: 'Tablet del salon', blocked: true, reasons: ['schedule'] },
    { id: 'dev-xyz', name: 'Portatil', blocked: false, reasons: [] },
  ],
  roomSignals: [
    { id: 'room-1', name: 'Salon', worstDbm: -67 },
    { id: 'room-2', name: 'Buhardilla', worstDbm: null },
  ],
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
    const msgs = buildDiscoveryConfigs(snap, 'casa', SOLO_IOT);
    const byTopic = new Map(msgs.map((m) => [m.topic, JSON.parse(m.payload || '{}')]));
    expect(byTopic.has('homeassistant/switch/krakenos/iot_plug-1/config')).toBe(true);
    expect(byTopic.has('homeassistant/light/krakenos/iot_luz/config')).toBe(true);
    const tira = byTopic.get('homeassistant/light/krakenos/iot_tira/config');
    expect(tira.rgb_command_topic).toBe('casa/iot/tira/rgb/set');
    expect(tira.brightness_scale).toBe(100);
    expect(byTopic.get('homeassistant/sensor/krakenos/home_mode/config').state_topic).toBe('casa/home/mode');
    expect(byTopic.get('homeassistant/sensor/krakenos/alarm/config')).toBeDefined();
    expect(byTopic.get('homeassistant/sensor/krakenos/energy_today/config').device_class).toBe('energy');
    expect(byTopic.has('homeassistant/sensor/krakenos/iot_plug-1_power/config')).toBe(true);
  });

  it('sin control: la luz cae a switch de solo lectura (sin command_topic)', () => {
    const msgs = buildDiscoveryConfigs(snap, 'casa', NADA);
    const luz = msgs.find((m) => m.topic === 'homeassistant/switch/krakenos/iot_luz/config');
    expect(luz).toBeDefined();
    expect(JSON.parse(luz!.payload).command_topic).toBeUndefined();
  });

  it('un sensor puro no genera entidad on/off', () => {
    const msgs = buildDiscoveryConfigs({ ...snap, iot: [sensor] }, 'casa', SOLO_IOT);
    expect(msgs.some((m) => m.topic.includes('iot_s1/config'))).toBe(false);
  });
});

// --- La cuña (US-236) ---

describe('availability y LWT (US-236)', () => {
  it('el testamento y el adiós apuntan al topic de disponibilidad, retenidos y offline', () => {
    expect(availabilityTopic('casa')).toBe('casa/status');
    expect(willMessage('casa')).toEqual({ topic: 'casa/status', payload: AVAILABILITY_OFFLINE, retain: true });
    expect(offlineMessage('casa')).toEqual({ topic: 'casa/status', payload: AVAILABILITY_OFFLINE, retain: true });
  });

  it('el estado publica `online` RETENIDO (si no, un HA que conecte después no lo ve)', () => {
    const status = buildStateMessages(snap, 'casa').find((m) => m.topic === 'casa/status');
    expect(status).toEqual({ topic: 'casa/status', payload: 'online', retain: true });
  });

  it('todas las entidades declaran su disponibilidad contra ese topic', () => {
    const configs = buildDiscoveryConfigs(snap, 'casa', TODO);
    for (const m of configs) {
      const cfg = JSON.parse(m.payload);
      const declara = cfg.availability_topic === 'casa/status'
        || (Array.isArray(cfg.availability) && cfg.availability.some((a: { topic: string }) => a.topic === 'casa/status'));
      expect(declara, `sin availability: ${m.topic}`).toBe(true);
    }
  });
});

describe('binary_sensor de internet bloqueado (US-236)', () => {
  it('expone una entidad por dispositivo, nombrada por el aparato y no por la persona', () => {
    const msgs = buildDiscoveryConfigs(snap, 'casa', NADA);
    const cfg = msgs.find((m) => m.topic === 'homeassistant/binary_sensor/krakenos/device_dev-abc_blocked/config');
    expect(cfg).toBeDefined();
    const payload = JSON.parse(cfg!.payload);
    expect(payload.state_topic).toBe('casa/device/dev-abc/blocked');
    expect(payload.name).toContain('Tablet del salon');
    // `connectivity` invertiría el significado y `problem` llamaría avería a un
    // corte programado: se publica sin device_class a propósito.
    expect(payload.device_class).toBeUndefined();
  });

  it('publica el DERIVADO de las tres fuentes, con la razón en los atributos', () => {
    const byTopic = new Map(buildStateMessages(snap, 'casa').map((m) => [m.topic, m.payload]));
    expect(byTopic.get('casa/device/dev-abc/blocked')).toBe('ON');
    expect(byTopic.get('casa/device/dev-xyz/blocked')).toBe('OFF');
    expect(JSON.parse(byTopic.get('casa/device/dev-abc/blocked/attributes')!)).toEqual({ razones: ['schedule'] });
  });
});

describe('botón de pausa (US-236)', () => {
  it('NO existe sin su propio toggle, aunque el control de IoT esté activo', () => {
    const soloIot = buildDiscoveryConfigs(snap, 'casa', SOLO_IOT);
    expect(soloIot.some((m) => m.topic.includes('/button/'))).toBe(false);
  });

  it('con su toggle: botón por dispositivo que publica los minutos', () => {
    const msgs = buildDiscoveryConfigs(snap, 'casa', TODO);
    const cfg = msgs.find((m) => m.topic === 'homeassistant/button/krakenos/device_dev-abc_pause/config');
    expect(cfg).toBeDefined();
    const payload = JSON.parse(cfg!.payload);
    expect(payload.command_topic).toBe('casa/device/dev-abc/pause/set');
    expect(payload.payload_press).toBe('30');
  });
});

describe('sensor de señal por habitación (US-236)', () => {
  it('publica dBm con doble disponibilidad (hub + habitación)', () => {
    const cfg = buildDiscoveryConfigs(snap, 'casa', NADA)
      .find((m) => m.topic === 'homeassistant/sensor/krakenos/room_room-1_signal/config');
    const payload = JSON.parse(cfg!.payload);
    expect(payload.unit_of_measurement).toBe('dBm');
    expect(payload.device_class).toBe('signal_strength');
    expect(payload.availability_mode).toBe('all');
    expect(payload.availability.map((a: { topic: string }) => a.topic)).toEqual([
      'casa/status',
      'casa/room/room-1/available',
    ]);
  });

  it('una habitación sin aparatos WiFi se declara NO disponible; nunca inventa un 0', () => {
    const byTopic = new Map(buildStateMessages(snap, 'casa').map((m) => [m.topic, m.payload]));
    expect(byTopic.get('casa/room/room-1/available')).toBe('online');
    expect(byTopic.get('casa/room/room-1/signal')).toBe('-67');
    expect(byTopic.get('casa/room/room-2/available')).toBe('offline');
    expect(byTopic.has('casa/room/room-2/signal')).toBe(false);
  });

  it('el estado es el dBm y NADA más (qué aparato es el peor sería presencia)', () => {
    const signal = buildStateMessages(snap, 'casa').find((m) => m.topic === 'casa/room/room-1/signal');
    expect(signal!.payload).toBe('-67');
    expect(signal!.payload).not.toMatch(/[a-z]/i);
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

  // El test de no-fuga se parte en DOS (US-236). Antes una sola regex mezclaba dos
  // reglas distintas y, al añadir entidades por dispositivo, buscar el substring
  // «mac» habría fallado con un aparato llamado «MacBook» —que no es una fuga— y
  // seguido pasando con una MAC de verdad. Cada regla se prueba por separado y
  // contra lo que de verdad protege.
  it('no filtra la lista de personas (regla de privacidad de US-169)', () => {
    const all = buildStateMessages(snap, 'casa').map((m) => `${m.topic} ${m.payload}`).join('\n');
    expect(all).not.toMatch(/person|people|displayName|ownerId/i);
    // Del hogar viaja SOLO el modo.
    expect(all).toContain('casa/home/mode');
  });

  it('no filtra MAC ni IP crudas (patrón real, no el substring «mac»)', () => {
    const all = [
      ...buildStateMessages(snap, 'casa'),
      ...buildDiscoveryConfigs(snap, 'casa', TODO),
    ].map((m) => `${m.topic} ${m.payload}`).join('\n');
    expect(all).not.toMatch(/\b[0-9a-f]{2}(:[0-9a-f]{2}){5}\b/i); // MAC
    expect(all).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/); // IPv4
  });
});

describe('parseInboundCommand (US-213 · US-236)', () => {
  it('interpreta ON/OFF, brillo y rgb', () => {
    expect(parseInboundCommand('casa/iot/plug-1/set', 'ON', 'casa')).toEqual({ kind: 'iot', deviceId: 'plug-1', state: { on: true } });
    expect(parseInboundCommand('casa/iot/plug-1/set', 'off', 'casa')).toEqual({ kind: 'iot', deviceId: 'plug-1', state: { on: false } });
    expect(parseInboundCommand('casa/iot/luz/brightness/set', '55', 'casa')).toEqual({ kind: 'iot', deviceId: 'luz', state: { brightness: 55 } });
    expect(parseInboundCommand('casa/iot/tira/rgb/set', '255,136,0', 'casa')).toEqual({ kind: 'iot', deviceId: 'tira', state: { color: { hex: '#ff8800' } } });
  });
  it('ignora topics ajenos y payloads basura (no lanza)', () => {
    expect(parseInboundCommand('otro/iot/x/set', 'ON', 'casa')).toBeNull();
    expect(parseInboundCommand('casa/iot/x/set', 'meh', 'casa')).toBeNull();
    expect(parseInboundCommand('casa/iot/x/brightness/set', 'NaN', 'casa')).toBeNull();
    expect(parseInboundCommand('casa/status', 'online', 'casa')).toBeNull();
  });
  it('acota el brillo a 0-100', () => {
    expect(parseInboundCommand('casa/iot/luz/brightness/set', '999', 'casa')).toEqual({ kind: 'iot', deviceId: 'luz', state: { brightness: 100 } });
  });

  it('interpreta la pausa y acota su duración (el broker no tiene sujeto: no se fía)', () => {
    expect(parseInboundCommand('casa/device/dev-abc/pause/set', '30', 'casa')).toEqual({ kind: 'pause', deviceId: 'dev-abc', minutes: 30 });
    // Payload vacío = el valor por defecto del botón.
    expect(parseInboundCommand('casa/device/dev-abc/pause/set', '', 'casa')).toEqual({ kind: 'pause', deviceId: 'dev-abc', minutes: 30 });
    // Una pausa absurda se acota a 24 h en vez de aceptarse.
    expect(parseInboundCommand('casa/device/dev-abc/pause/set', '999999', 'casa')).toEqual({ kind: 'pause', deviceId: 'dev-abc', minutes: 1440 });
    expect(parseInboundCommand('casa/device/dev-abc/pause/set', '-5', 'casa')).toBeNull();
    expect(parseInboundCommand('casa/device/dev-abc/otra/set', '30', 'casa')).toBeNull();
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

describe('commandFilters (US-236)', () => {
  it('solo suscribe los filtros de lo ACTIVADO: no suscribirse es la garantía real', () => {
    expect(commandFilters('casa', NADA)).toEqual([]);
    expect(commandFilters('casa', SOLO_IOT)).toEqual([
      'casa/iot/+/set',
      'casa/iot/+/brightness/set',
      'casa/iot/+/rgb/set',
      // US-247: la posición de una persiana entra por su propio topic.
      'casa/iot/+/position/set',
    ]);
    expect(commandFilters('casa', { iot: false, pause: true })).toEqual(['casa/device/+/pause/set']);
    expect(commandFilters('casa', TODO)).toHaveLength(5);
  });
});

/**
 * US-247 — cierra lo que US-244 dejó anotado: `exposureFor` descartaba con
 * `on === null` a `contact`, `smoke`, `cover`, `climate` y `lock`. Era correcto
 * (ninguno es on/off) y no era completo: HA tiene `cover` y `binary_sensor`
 * nativos, así que media casa se quedaba fuera de la interop sin decirlo.
 */
describe('categorías nuevas en la interop con HA (US-247)', () => {
  const persiana: SnapshotIotDevice = {
    id: 'per-1', name: 'Persiana', kind: 'cover', on: null, brightness: null, color: null,
    readings: [], position: 70,
  };
  const puerta: SnapshotIotDevice = {
    id: 'con-1', name: 'Puerta', kind: 'contact', on: null, brightness: null, color: null,
    readings: [{ metric: 'contact', value: 1, unit: '' }, { metric: 'battery', value: 80, unit: '%' }],
  };
  const detector: SnapshotIotDevice = {
    id: 'hum-1', name: 'Detector', kind: 'smoke', on: null, brightness: null, color: null,
    readings: [{ metric: 'smoke', value: 0, unit: '' }, { metric: 'co', value: 1, unit: '' }],
  };
  const termostato: SnapshotIotDevice = {
    id: 'ter-1', name: 'Termostato', kind: 'climate', on: null, brightness: null, color: null,
    readings: [{ metric: 'temperature', value: 19.8, unit: '°C' }], targetC: 21.5,
  };
  const cerradura: SnapshotIotDevice = {
    id: 'cer-1', name: 'Cerradura', kind: 'lock', on: null, brightness: null, color: null,
    readings: [], locked: true,
  };
  const nuevoSnap: StateSnapshot = { ...snap, iot: [persiana, puerta, detector, termostato, cerradura] };

  const configs = (control: ControlFlags) =>
    new Map(buildDiscoveryConfigs(nuevoSnap, 'casa', control).map((m) => [m.topic, JSON.parse(m.payload || '{}')]));
  const estados = () => new Map(buildStateMessages(nuevoSnap, 'casa').map((m) => [m.topic, m.payload]));

  it('una persiana es un `cover` con posición', () => {
    const c = configs(SOLO_IOT).get('homeassistant/cover/krakenos/iot_per-1/config');
    expect(c).toMatchObject({
      position_topic: 'casa/iot/per-1/position',
      set_position_topic: 'casa/iot/per-1/position/set',
      command_topic: 'casa/iot/per-1/set',
      device_class: 'shade',
    });
    // `payload_on`/`payload_off` son de un switch: en un cover HA espera
    // open/closed y dejarlos colados haría que no casara ningún estado.
    expect(c).not.toHaveProperty('payload_on');
    expect(estados().get('casa/iot/per-1/position')).toBe('70');
    expect(estados().get('casa/iot/per-1/cover_state')).toBe('open');
  });

  it('sin control entrante, la persiana se publica sin comandos', () => {
    const c = configs(NADA).get('homeassistant/cover/krakenos/iot_per-1/config');
    expect(c).not.toHaveProperty('command_topic');
    expect(c).not.toHaveProperty('set_position_topic');
  });

  it('⚠️ la cerradura NUNCA lleva command_topic, ni con el control activo', () => {
    // `lock` está fuera de `CONTROLLABLE_IOT_KINDS` mientras US-246 no decida la
    // política de desbloqueo. Publicar un `lock` de HA con comando sería tomar esa
    // decisión de refilón, con la puerta de la calle de por medio.
    const c = configs(TODO).get('homeassistant/binary_sensor/krakenos/iot_cer-1_lock/config');
    expect(c).toMatchObject({ device_class: 'lock', state_topic: 'casa/iot/cer-1/locked' });
    expect(c).not.toHaveProperty('command_topic');
    expect(configs(TODO).has('homeassistant/lock/krakenos/iot_cer-1/config')).toBe(false);
  });

  it('⚠️ la cerradura echada se publica como OFF (en HA `lock` ON = abierta)', () => {
    expect(estados().get('casa/iot/cer-1/locked')).toBe('OFF');
    const abierta: StateSnapshot = { ...snap, iot: [{ ...cerradura, locked: false }] };
    const m = new Map(buildStateMessages(abierta, 'casa').map((x) => [x.topic, x.payload]));
    expect(m.get('casa/iot/cer-1/locked')).toBe('ON');
  });

  it('cada lectura es su propia entidad, con su device_class', () => {
    const c = configs(SOLO_IOT);
    expect(c.get('homeassistant/binary_sensor/krakenos/iot_con-1_contact/config')).toMatchObject({
      device_class: 'door',
      name: 'Puerta apertura',
      state_topic: 'casa/iot/con-1/contact',
    });
    expect(c.get('homeassistant/sensor/krakenos/iot_con-1_battery/config')).toMatchObject({
      device_class: 'battery',
      unit_of_measurement: '%',
    });
    // Un detector combinado son DOS entidades, no una: humo y CO son riesgos
    // distintos y en HA se encadenan a automatizaciones distintas.
    expect(c.has('homeassistant/binary_sensor/krakenos/iot_hum-1_smoke/config')).toBe(true);
    expect(c.get('homeassistant/binary_sensor/krakenos/iot_hum-1_co/config')).toMatchObject({
      device_class: 'carbon_monoxide',
    });
  });

  it('los estados de las lecturas se publican con la polaridad de HA', () => {
    const e = estados();
    expect(e.get('casa/iot/con-1/contact')).toBe('ON'); // 1 = abierta
    expect(e.get('casa/iot/con-1/battery')).toBe('80');
    expect(e.get('casa/iot/hum-1/smoke')).toBe('OFF');
    expect(e.get('casa/iot/hum-1/co')).toBe('ON');
  });

  it('el termostato publica consigna y temperatura, y NO se inventa un `climate`', () => {
    const c = configs(SOLO_IOT);
    // Un `climate` de HA exige modos (heat/cool/auto) que el contrato no tiene.
    expect(c.has('homeassistant/climate/krakenos/iot_ter-1/config')).toBe(false);
    expect(c.get('homeassistant/sensor/krakenos/iot_ter-1_target/config')).toMatchObject({
      unit_of_measurement: '°C',
      name: 'Termostato consigna',
    });
    expect(estados().get('casa/iot/ter-1/target')).toBe('21.5');
    expect(estados().get('casa/iot/ter-1/temperature')).toBe('19.8');
  });

  it('⚠️ la potencia NO se duplica desde las lecturas', () => {
    // `powerW` ya tiene su entidad desde US-213; publicarla otra vez desde la
    // lectura daría dos entidades para el mismo vatio, que en HA se ven como dos.
    const conAmbos: StateSnapshot = {
      ...snap,
      iot: [{ ...plug, powerW: 12, readings: [{ metric: 'power', value: 12, unit: 'W' }] }],
    };
    const topics = buildDiscoveryConfigs(conAmbos, 'casa', SOLO_IOT).map((m) => m.topic);
    expect(topics.filter((t) => t.includes('plug-1') && t.includes('power'))).toHaveLength(1);
  });

  it('un aparato sin lecturas no publica entidades de sensor', () => {
    // «Un dato que no existe no se publica inventado» (US-236).
    const topics = buildDiscoveryConfigs({ ...snap, iot: [cerradura] }, 'casa', SOLO_IOT).map((m) => m.topic);
    expect(topics.filter((t) => t.startsWith('homeassistant/sensor/krakenos/iot_'))).toHaveLength(0);
  });
});

describe('control entrante de persianas (US-247)', () => {
  it('HA manda OPEN/CLOSE por el command_topic de un cover', () => {
    expect(parseInboundCommand('casa/iot/per-1/set', 'OPEN', 'casa')).toEqual({
      kind: 'iot', deviceId: 'per-1', state: { on: true },
    });
    expect(parseInboundCommand('casa/iot/per-1/set', 'CLOSE', 'casa')).toEqual({
      kind: 'iot', deviceId: 'per-1', state: { on: false },
    });
  });

  it('la posición entra acotada a 0-100', () => {
    expect(parseInboundCommand('casa/iot/per-1/position/set', '35', 'casa')).toEqual({
      kind: 'iot', deviceId: 'per-1', state: { position: 35 },
    });
    expect(parseInboundCommand('casa/iot/per-1/position/set', '400', 'casa')).toEqual({
      kind: 'iot', deviceId: 'per-1', state: { position: 100 },
    });
    expect(parseInboundCommand('casa/iot/per-1/position/set', 'basura', 'casa')).toBeNull();
  });

  it('STOP no se acepta: el contrato no sabe parar a media altura', () => {
    expect(parseInboundCommand('casa/iot/per-1/set', 'STOP', 'casa')).toBeNull();
  });

  it('⚠️ el filtro de posición existe (no suscribirse es no poder controlar)', () => {
    // Sin este filtro, la persiana se vería controlable en HA y arrastrar el mando
    // no haría nada: el `set_position_topic` publicado y nadie escuchando.
    expect(commandFilters('casa', SOLO_IOT)).toContain('casa/iot/+/position/set');
    // Y sigue atado al mismo toggle: sin control entrante no se suscribe nada.
    expect(commandFilters('casa', NADA)).toEqual([]);
  });
});
