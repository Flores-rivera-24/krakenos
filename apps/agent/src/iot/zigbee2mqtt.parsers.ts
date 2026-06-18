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
export function inferKind(exposes: unknown): IotDeviceKind {
  const { names, types } = exposeFeatureNames(exposes);
  if (types.has('light') || names.has('brightness')) return 'light';
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
  reading: IotReading | null;
}

/** Mapea un mensaje de estado de zigbee2mqtt a `{on, brightness, reading}`. */
export function parseDeviceState(json: unknown): ZigbeeState {
  const s = asRecord(json);
  const on = s.state === 'ON' ? true : s.state === 'OFF' ? false : null;
  const brightness = typeof s.brightness === 'number' ? brightnessFromZigbee(s.brightness) : null;
  let reading: IotReading | null = null;
  if (typeof s.temperature === 'number') {
    reading = { metric: 'temperatura', value: s.temperature, unit: '°C' };
  } else if (typeof s.humidity === 'number') {
    reading = { metric: 'humedad', value: s.humidity, unit: '%' };
  }
  return { on, brightness, reading };
}

/** Construye el payload de `zigbee2mqtt/<id>/set` para una petición de control. */
export function buildSetPayload(input: UpdateIotStateRequest, kind: IotDeviceKind): string {
  const payload: Record<string, unknown> = {};
  if (input.on !== undefined) payload.state = input.on ? 'ON' : 'OFF';
  if (input.brightness !== undefined && kind === 'light') {
    payload.brightness = brightnessToZigbee(input.brightness);
    // Ajustar el brillo enciende la luz si no se indicó `on`.
    if (input.on === undefined) payload.state = input.brightness > 0 ? 'ON' : 'OFF';
  }
  return JSON.stringify(payload);
}
