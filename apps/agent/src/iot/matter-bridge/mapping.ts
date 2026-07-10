import type {
  IotDevice,
  MatterBridgeEndpoint,
  MatterEndpointType,
  UpdateIotStateRequest,
} from '@krakenos/types';

/**
 * Mapeo **puro** IoT ↔ Matter para el puente (US-171). Aquí vive el contrato que
 * se testea sin stack real: qué tipo de endpoint Matter corresponde a cada
 * aparato y cómo se traduce un comando Matter entrante a un `setState` del IoT.
 */

/**
 * Tipo de endpoint Matter para un dispositivo, o `null` si no se puede exponer
 * (sensores y aparatos no controlables no entran en el puente).
 * - `plug` → `onoff`
 * - `light` con color → `color`
 * - `light` con brillo → `dimmable`
 * - `light` sin brillo → `onoff`
 */
export function endpointTypeFor(device: IotDevice): MatterEndpointType | null {
  if (device.kind === 'plug') return 'onoff';
  if (device.kind === 'light') {
    if (device.color !== null) return 'color';
    if (device.brightness !== null) return 'dimmable';
    return 'onoff';
  }
  return null; // sensor u otro: no controlable por voz
}

/** Convierte un `IotDevice` en un endpoint del puente, o `null` si no aplica. */
export function toBridgeEndpoint(device: IotDevice): MatterBridgeEndpoint | null {
  const type = endpointTypeFor(device);
  if (type === null) return null;
  return { deviceId: device.id, name: device.name, type };
}

/** Comando Matter entrante normalizado (independiente del stack concreto). */
export interface MatterIncomingCommand {
  /** OnOff cluster: encender/apagar. */
  on?: boolean;
  /** LevelControl cluster: nivel 0-254 (Matter) → se convierte a 0-100. */
  level?: number;
  /** ColorControl: matiz/saturación o temperatura (mireds). */
  hue?: number;
  saturation?: number;
  /** Temperatura de color en mireds (1e6/kelvin). */
  colorTempMireds?: number;
}

/** Nivel Matter (0-254) → brillo porcentual (0-100). */
export function levelToPercent(level: number): number {
  return Math.max(0, Math.min(100, Math.round((level / 254) * 100)));
}

/** Brillo porcentual (0-100) → nivel Matter (0-254). */
export function percentToLevel(percent: number): number {
  return Math.max(0, Math.min(254, Math.round((percent / 100) * 254)));
}

/** Mireds → Kelvin (Matter usa mireds = 1e6 / kelvin). */
export function miredsToKelvin(mireds: number): number {
  if (mireds <= 0) return 0;
  return Math.round(1_000_000 / mireds);
}

/** Matiz/saturación Matter (0-254 / 0-254) → hex `#rrggbb`. */
export function hueSatToHex(hue: number, saturation: number): string {
  const h = (hue / 254) * 360;
  const s = saturation / 254;
  const v = 1;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to2 = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/**
 * Traduce un comando Matter entrante al `UpdateIotStateRequest` del IoT. Solo se
 * incluyen los campos presentes en el comando (parcial), para no pisar estado no
 * tocado. Devuelve `null` si el comando no contiene nada aplicable.
 */
export function matterCommandToState(cmd: MatterIncomingCommand): UpdateIotStateRequest | null {
  const out: UpdateIotStateRequest = {};
  if (cmd.on !== undefined) out.on = cmd.on;
  if (cmd.level !== undefined) out.brightness = levelToPercent(cmd.level);
  if (cmd.colorTempMireds !== undefined) {
    out.color = { temperatureK: miredsToKelvin(cmd.colorTempMireds) };
  } else if (cmd.hue !== undefined && cmd.saturation !== undefined) {
    out.color = { hex: hueSatToHex(cmd.hue, cmd.saturation) };
  }
  return Object.keys(out).length > 0 ? out : null;
}
