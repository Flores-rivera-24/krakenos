import type { IotColor, IotDevice } from '@krakenos/types';

/**
 * Builders/parsers **puros** de la API LAN de Govee (mensajes JSON UDP). Sin
 * red: se testean con fixtures. La I/O (sockets) vive en `GoveeIotManager` +
 * el transporte UDP.
 */

/** Puertos estándar de la API LAN de Govee. */
export const GOVEE_MULTICAST = '239.255.255.250';
export const GOVEE_SCAN_PORT = 4001;
export const GOVEE_CONTROL_PORT = 4003;

function msg(cmd: string, data: Record<string, unknown>): string {
  return JSON.stringify({ msg: { cmd, data } });
}

export function buildScan(): string {
  return msg('scan', { account_topic: 'reserve' });
}
export function buildStatus(): string {
  return msg('devStatus', {});
}
export function buildTurn(on: boolean): string {
  return msg('turn', { value: on ? 1 : 0 });
}
export function buildBrightness(value: number): string {
  return msg('brightness', { value: Math.max(0, Math.min(100, Math.round(value))) });
}
export function buildColorRgb(hex: string): string {
  return msg('colorwc', { color: hexToRgb(hex), colorTemInKelvin: 0 });
}
export function buildColorTemp(kelvin: number): string {
  return msg('colorwc', { color: { r: 0, g: 0, b: 0 }, colorTemInKelvin: Math.round(kelvin) });
}

/** `#rrggbb` → `{r,g,b}` (0-255). */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { r: 255, g: 255, b: 255 };
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** `{r,g,b}` → `#rrggbb`. */
export function rgbToHex(c: { r?: unknown; g?: unknown; b?: unknown }): string {
  const byte = (v: unknown) =>
    Math.max(0, Math.min(255, typeof v === 'number' ? v : 0))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}`;
}

/** Mensaje Govee parseado: comando + datos. */
export interface GoveeMessage {
  cmd: string;
  data: Record<string, unknown>;
}

/** Parsea un datagrama JSON de Govee (`{ msg: { cmd, data } }`). */
export function parseGoveeMessage(payload: string): GoveeMessage | null {
  try {
    const obj = JSON.parse(payload) as { msg?: { cmd?: unknown; data?: unknown } };
    const cmd = obj.msg?.cmd;
    if (typeof cmd !== 'string') return null;
    const data = obj.msg?.data;
    return { cmd, data: data && typeof data === 'object' ? (data as Record<string, unknown>) : {} };
  } catch {
    return null;
  }
}

/** Estado/metadatos cacheados de un dispositivo Govee. */
export interface GoveeDevice {
  id: string;
  ip: string;
  sku: string | null;
  state: Record<string, unknown> | null;
}

function deviceColor(state: Record<string, unknown> | null): IotColor {
  if (!state) return { hex: '#ffffff', temperatureK: null };
  const k = state.colorTemInKelvin;
  if (typeof k === 'number' && k > 0) return { hex: null, temperatureK: k };
  return { hex: rgbToHex((state.color as Record<string, unknown>) ?? {}), temperatureK: null };
}

/** Mapea un dispositivo Govee cacheado a `IotDevice` (siempre luz con color). */
export function goveeToIotDevice(dev: GoveeDevice): IotDevice {
  const onOff = dev.state?.onOff;
  const brightness = dev.state?.brightness;
  return {
    id: dev.id,
    name: dev.sku ? `Govee ${dev.sku}` : `Govee ${dev.id}`,
    kind: 'light',
    room: null,
    reachable: true,
    on: onOff === 1 ? true : onOff === 0 ? false : null,
    brightness: typeof brightness === 'number' ? brightness : null,
    color: deviceColor(dev.state),
    reading: null,
  };
}
