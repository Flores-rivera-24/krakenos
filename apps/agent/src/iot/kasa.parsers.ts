import type { IotColor, IotDevice } from '@krakenos/types';

/**
 * Builders/parsers **puros** para TP-Link **Kasa** (Gen1/2, protocolo TCP/UDP
 * local con cifrado XOR autokey) y **Tapo** (Gen3+, JSON sobre sesión KLAP). El
 * transporte (sockets/crypto) es inyectable; aquí solo vive la lógica testeable:
 * el cifrado XOR, los comandos JSON y el mapeo a `IotDevice`.
 */

// ---- Kasa: cifrado XOR autokey (clave inicial 0xAB) ----

const KASA_INITIAL_KEY = 0xab;

/** Cifra un payload Kasa con el XOR autokey (clave encadenada con el cifrado). */
export function kasaEncrypt(text: string): Buffer {
  const input = Buffer.from(text, 'utf8');
  const out = Buffer.alloc(input.length);
  let key = KASA_INITIAL_KEY;
  for (let i = 0; i < input.length; i++) {
    key = input[i]! ^ key;
    out[i] = key;
  }
  return out;
}

/** Descifra un payload Kasa cifrado con `kasaEncrypt`. */
export function kasaDecrypt(buf: Buffer): string {
  const out = Buffer.alloc(buf.length);
  let key = KASA_INITIAL_KEY;
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i]! ^ key;
    key = buf[i]!;
  }
  return out.toString('utf8');
}

/** Enmarca un payload para TCP (puerto 9999): cabecera de longitud BE de 4 bytes. */
export function frameKasaTcp(text: string): Buffer {
  const body = kasaEncrypt(text);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Quita la cabecera de longitud TCP y descifra. */
export function deframeKasaTcp(buf: Buffer): string {
  return kasaDecrypt(buf.subarray(4));
}

// ---- Kasa: comandos JSON ----

export const KASA_SYSINFO = '{"system":{"get_sysinfo":{}}}';

export function buildKasaRelay(on: boolean): string {
  return JSON.stringify({ system: { set_relay_state: { state: on ? 1 : 0 } } });
}

export function buildKasaBrightness(value: number): string {
  return JSON.stringify({
    'smartlife.iot.dimmer': { set_brightness: { brightness: clampPct(value) } },
  });
}

/** Estado de luz para bulbs (HSV o temperatura); enciende si se aplica. */
export function buildKasaLightState(input: {
  on?: boolean;
  brightness?: number;
  hue?: number;
  saturation?: number;
  colorTemp?: number;
}): string {
  const state: Record<string, number> = {};
  if (input.on !== undefined) state.on_off = input.on ? 1 : 0;
  if (input.brightness !== undefined) state.brightness = clampPct(input.brightness);
  if (input.colorTemp !== undefined) {
    state.color_temp = Math.round(input.colorTemp);
  }
  if (input.hue !== undefined && input.saturation !== undefined) {
    state.hue = Math.round(input.hue);
    state.saturation = Math.round(input.saturation);
    state.color_temp = 0;
  }
  return JSON.stringify({ 'smartlife.iot.smartbulb.lightingservice': { transition_light_state: state } });
}

// ---- Kasa: parseo de get_sysinfo ----

export interface KasaState {
  ip: string;
  alias: string;
  isLight: boolean;
  on: boolean;
  brightness: number | null;
  color: IotColor | null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Mapea `get_sysinfo` (envuelto en `{system:{get_sysinfo:{…}}}` o directo) a un
 * estado normalizado. Distingue bulb (tiene `light_state`/`is_dimmable`) de plug
 * (tiene `relay_state`). Devuelve `null` si no hay datos reconocibles.
 */
export function parseKasaSysinfo(ip: string, raw: unknown): KasaState | null {
  const root = (raw ?? {}) as Record<string, unknown>;
  const sysinfo = ((root.system as Record<string, unknown>)?.get_sysinfo ?? root) as Record<string, unknown>;
  if (!sysinfo || typeof sysinfo !== 'object') return null;
  const alias = typeof sysinfo.alias === 'string' ? sysinfo.alias : 'Kasa';
  const type = String(sysinfo.mic_type ?? sysinfo.type ?? '');
  const isLight = type.includes('BULB') || 'light_state' in sysinfo;

  if (isLight) {
    const ls = (sysinfo.light_state ?? {}) as Record<string, unknown>;
    const on = (ls.on_off ?? 0) === 1;
    // Cuando está apagada, el estado activo vive en `dft_on_state`.
    const active = on ? ls : ((ls.dft_on_state ?? ls) as Record<string, unknown>);
    const brightness = num(active.brightness) ?? 0;
    const colorTemp = num(active.color_temp) ?? 0;
    const color: IotColor =
      colorTemp > 0
        ? { hex: null, temperatureK: colorTemp }
        : { hex: hsvToHex(num(active.hue) ?? 0, num(active.saturation) ?? 0, 100), temperatureK: null };
    return { ip, alias, isLight: true, on, brightness, color: sysinfo.is_color === 1 || colorTemp > 0 ? color : null };
  }

  const relay = num(sysinfo.relay_state) ?? 0;
  return { ip, alias, isLight: false, on: relay === 1, brightness: null, color: null };
}

/** Convierte un `KasaState` a `IotDevice` con id `kasa:<ip>`. */
export function kasaToIotDevice(s: KasaState): IotDevice {
  return {
    id: `kasa:${s.ip}`,
    name: s.alias,
    kind: s.isLight ? 'light' : 'plug',
    room: null,
    reachable: true,
    on: s.on,
    brightness: s.brightness,
    color: s.color,
    reading: null,
  };
}

// ---- Tapo: comandos y parseo (JSON sobre sesión KLAP) ----

export interface TapoCommand {
  method: string;
  params?: Record<string, unknown>;
}

export function buildTapoSetOn(on: boolean): TapoCommand {
  return { method: 'set_device_info', params: { device_on: on } };
}

export function buildTapoSetBrightness(value: number): TapoCommand {
  return { method: 'set_device_info', params: { brightness: clampPct(value) } };
}

export function buildTapoSetColor(input: { hue?: number; saturation?: number; colorTempK?: number }): TapoCommand {
  const params: Record<string, unknown> = {};
  if (input.colorTempK !== undefined) params.color_temp = Math.round(input.colorTempK);
  if (input.hue !== undefined && input.saturation !== undefined) {
    params.hue = Math.round(input.hue);
    params.saturation = Math.round(input.saturation);
    params.color_temp = 0;
  }
  return { method: 'set_device_info', params };
}

export interface TapoState {
  ip: string;
  name: string;
  isLight: boolean;
  on: boolean;
  brightness: number | null;
  color: IotColor | null;
}

/**
 * Mapea la respuesta de `get_device_info` (en `result` o directa) a un estado
 * normalizado. El `nickname` viaja en base64; el `model` distingue bulb (L…) de
 * plug (P…).
 */
export function parseTapoDeviceInfo(ip: string, raw: unknown): TapoState {
  const info = ((raw as { result?: unknown })?.result ?? raw ?? {}) as Record<string, unknown>;
  const model = String(info.model ?? '');
  const isLight = /^L/i.test(model) || info.brightness !== undefined || info.color_temp !== undefined;
  const name = decodeNickname(info.nickname) ?? (model || 'Tapo');
  const on = info.device_on === true;
  const brightness = isLight ? (num(info.brightness) ?? 0) : null;
  const colorTemp = num(info.color_temp) ?? 0;
  let color: IotColor | null = null;
  if (isLight) {
    color =
      colorTemp > 0
        ? { hex: null, temperatureK: colorTemp }
        : { hex: hsvToHex(num(info.hue) ?? 0, num(info.saturation) ?? 0, 100), temperatureK: null };
  }
  return { ip, name, isLight, on, brightness, color };
}

/** Convierte un `TapoState` a `IotDevice` con id `tapo:<ip>`. */
export function tapoToIotDevice(s: TapoState): IotDevice {
  return {
    id: `tapo:${s.ip}`,
    name: s.name,
    kind: s.isLight ? 'light' : 'plug',
    room: null,
    reachable: true,
    on: s.on,
    brightness: s.brightness,
    color: s.color,
    reading: null,
  };
}

function decodeNickname(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

// ---- Helpers de color (compartidos) ----

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Convierte HSV (h 0-360, s 0-100, v 0-100) a hex `#rrggbb`. */
export function hsvToHex(h: number, s: number, v: number): string {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Convierte hex `#rrggbb` a HSV (h 0-360, s 0-100, v 0-100). */
export function hexToHsv(hex: string): { hue: number; saturation: number; value: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : Math.round((d / max) * 100);
  return { hue: h, saturation: s, value: Math.round(max * 100) };
}
