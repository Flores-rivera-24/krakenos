import type { IotDeviceKind, IotReading, UpdateIotStateRequest } from '@krakenos/types';

/**
 * Parsers/builders **puros** para zigbee2mqtt. Mapean los mensajes MQTT (ya
 * deserializados) a los tipos del contrato y construyen el payload de control,
 * de modo que se testean sin un broker ni dispositivos reales.
 */

/** Metadatos de un dispositivo derivados de `zigbee2mqtt/bridge/devices`. */
export interface ZigbeeDeviceMeta {
  /** `friendly_name`, usado como id y en el topic de control. */
  id: string;
  name: string;
  kind: IotDeviceKind;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Brillo 0-100 (KrakenOS) → 0-254 (zigbee2mqtt). */
export function brightnessToZigbee(percent: number): number {
  return Math.round((Math.max(0, Math.min(100, percent)) / 100) * 254);
}

/** Brillo 0-254 (zigbee2mqtt) → 0-100 (KrakenOS). */
export function brightnessFromZigbee(raw: number): number {
  return Math.round((Math.max(0, Math.min(254, raw)) / 254) * 100);
}

/** Recolecta los nombres de feature de un árbol de `exposes` (plano o anidado). */
function exposeFeatureNames(exposes: unknown): { names: Set<string>; types: Set<string> } {
  const names = new Set<string>();
  const types = new Set<string>();
  const visit = (node: unknown) => {
    const rec = asRecord(node);
    if (typeof rec.type === 'string') types.add(rec.type);
    if (typeof rec.name === 'string') names.add(rec.name);
    if (Array.isArray(rec.features)) rec.features.forEach(visit);
  };
  if (Array.isArray(exposes)) exposes.forEach(visit);
  return { names, types };
}

/** Infiere la categoría KrakenOS a partir de los `exposes` de zigbee2mqtt. */
/**
 * Infiere la categoría KrakenOS a partir de los `exposes` de zigbee2mqtt.
 *
 * ⚠️ **El orden no es estético: las categorías específicas van ANTES que
 * `switch`** (US-244). Una cerradura y una persiana exponen `state` —con valores
 * `LOCK`/`UNLOCK` y `OPEN`/`CLOSE`, no `ON`/`OFF`—, así que con la comprobación
 * de `state` por delante se clasificaban como **enchufe**: la UI les pintaba un
 * interruptor y `buildSetPayload` les mandaba `{"state":"ON"}`, que no significa
 * nada para ninguno de los dos.
 */
export function inferKind(exposes: unknown): IotDeviceKind {
  const { names, types } = exposeFeatureNames(exposes);
  if (types.has('light') || names.has('brightness')) return 'light';
  if (types.has('lock') || names.has('lock_state')) return 'lock';
  if (types.has('cover') || names.has('position')) return 'cover';
  if (types.has('climate') || names.has('occupied_heating_setpoint')) return 'climate';
  // Humo antes que contacto: un detector combinado (humo + tamper) es un `smoke`.
  if (names.has('smoke') || names.has('carbon_monoxide')) return 'smoke';
  if (names.has('contact')) return 'contact';
  if (types.has('switch') || names.has('state')) return 'plug';
  return 'sensor';
}

/**
 * Mapea `zigbee2mqtt/bridge/devices` (array) a metadatos. Descarta el
 * coordinador y dispositivos sin `friendly_name`.
 */
export function parseBridgeDevices(json: unknown): ZigbeeDeviceMeta[] {
  const list = Array.isArray(json) ? json : [];
  const out: ZigbeeDeviceMeta[] = [];
  for (const raw of list) {
    const dev = asRecord(raw);
    const name = typeof dev.friendly_name === 'string' ? dev.friendly_name : null;
    if (!name || dev.type === 'Coordinator') continue;
    const exposes = asRecord(dev.definition).exposes;
    out.push({ id: name, name, kind: inferKind(exposes) });
  }
  return out;
}

/** Estado normalizado de un dispositivo a partir de su mensaje de estado. */
export interface ZigbeeState {
  on: boolean | null;
  brightness: number | null;
  readings: IotReading[];
  position: number | null;
  targetC: number | null;
  locked: boolean | null;
}

/**
 * Mapea un mensaje de estado de zigbee2mqtt al estado normalizado (US-244).
 *
 * Antes solo se leían `temperature` y `humidity`, y **en un `else if`**: un sensor
 * de clima perdía la humedad, y —lo grave— un sensor de contacto, uno de presencia
 * y un detector de humo no producían **ninguna** lectura, así que no generaban
 * ningún evento y `alarm.config.sensorDeviceIds` era decorativa.
 */
export function parseDeviceState(json: unknown): ZigbeeState {
  const s = asRecord(json);
  const on = s.state === 'ON' ? true : s.state === 'OFF' ? false : null;
  const brightness = typeof s.brightness === 'number' ? brightnessFromZigbee(s.brightness) : null;

  const readings: IotReading[] = [];
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

  // Magnitudes: se acumulan TODAS (nada de `else if`).
  const temperature = num(s.temperature);
  if (temperature !== null) readings.push({ metric: 'temperature', value: temperature, unit: '°C' });
  const humidity = num(s.humidity);
  if (humidity !== null) readings.push({ metric: 'humidity', value: humidity, unit: '%' });
  const illuminance = num(s.illuminance_lux ?? s.illuminance);
  if (illuminance !== null) readings.push({ metric: 'illuminance', value: illuminance, unit: 'lx' });
  const battery = num(s.battery);
  if (battery !== null) readings.push({ metric: 'battery', value: battery, unit: '%' });
  const power = num(s.power);
  if (power !== null) readings.push({ metric: 'power', value: power, unit: 'W' });

  // Sucesos de seguridad: 1 = activo, 0 = reposo.
  //
  // ⚠️ **`contact: true` en zigbee2mqtt significa CERRADO** (el contacto está
  // hecho), así que se invierte: lo que la alarma tiene que ver como «pasa algo»
  // es la puerta ABIERTA. Sin invertir, la alarma saltaría al cerrar la puerta y
  // callaría al abrirla — funcionando exactamente al revés y sin ningún error.
  if (typeof s.contact === 'boolean') {
    readings.push({ metric: 'contact', value: s.contact ? 0 : 1, unit: '' });
  }
  if (typeof s.occupancy === 'boolean') {
    readings.push({ metric: 'occupancy', value: s.occupancy ? 1 : 0, unit: '' });
  }
  if (typeof s.smoke === 'boolean') {
    readings.push({ metric: 'smoke', value: s.smoke ? 1 : 0, unit: '' });
  }
  if (typeof s.carbon_monoxide === 'boolean') {
    readings.push({ metric: 'co', value: s.carbon_monoxide ? 1 : 0, unit: '' });
  }

  // Persiana, clima y cerradura.
  const position = num(s.position);
  const targetC = num(s.occupied_heating_setpoint ?? s.current_heating_setpoint);
  const lockState = s.lock_state ?? s.state;
  const locked =
    lockState === 'LOCK' || lockState === 'locked'
      ? true
      : lockState === 'UNLOCK' || lockState === 'unlocked'
        ? false
        : null;

  return { on, brightness, readings, position, targetC, locked };
}

/** Construye el payload de `zigbee2mqtt/<id>/set` para una petición de control. */
export function buildSetPayload(input: UpdateIotStateRequest, kind: IotDeviceKind): string {
  const payload: Record<string, unknown> = {};
  // Una persiana se manda por `position`; su `state` es OPEN/CLOSE, no ON/OFF, así
  // que mandarle `on` sería mandarle un valor que no entiende (US-244).
  if (kind === 'cover') {
    if (input.position !== undefined) payload.position = Math.max(0, Math.min(100, input.position));
    else if (input.on !== undefined) payload.state = input.on ? 'OPEN' : 'CLOSE';
    return JSON.stringify(payload);
  }
  if (kind === 'climate') {
    if (input.targetC !== undefined) payload.occupied_heating_setpoint = input.targetC;
    return JSON.stringify(payload);
  }
  if (input.on !== undefined) payload.state = input.on ? 'ON' : 'OFF';
  if (input.brightness !== undefined && kind === 'light') {
    payload.brightness = brightnessToZigbee(input.brightness);
    // Ajustar el brillo enciende la luz si no se indicó `on`.
    if (input.on === undefined) payload.state = input.brightness > 0 ? 'ON' : 'OFF';
  }
  return JSON.stringify(payload);
}
