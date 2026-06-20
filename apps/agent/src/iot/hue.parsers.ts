import type { IotColor, IotDevice, UpdateIotStateRequest } from '@krakenos/types';

/**
 * Parsers/builders **puros** para la CLIP API v2 del Philips Hue bridge. Mapean
 * los recursos `light` a `IotDevice` y construyen el cuerpo de los PUT, incluida
 * la conversión de color CIE xy ↔ sRGB. Sin red: se testean con fixtures.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Mirek (1e6/K) ↔ Kelvin. */
export function mirekToKelvin(mirek: number): number {
  return Math.round(1_000_000 / mirek);
}
export function kelvinToMirek(kelvin: number): number {
  // Rango físico del bridge: 153 (≈6500K) … 500 (2000K).
  return Math.max(153, Math.min(500, Math.round(1_000_000 / kelvin)));
}

function gammaCorrect(c: number): number {
  return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
}
function gammaUncorrect(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** Convierte `#rrggbb` a coordenadas CIE xy (gamut Hue). */
export function hexToXy(hex: string): { x: number; y: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { x: 0.3127, y: 0.329 }; // blanco D65 por defecto
  const n = parseInt(m[1]!, 16);
  const r = gammaCorrect(((n >> 16) & 0xff) / 255);
  const g = gammaCorrect(((n >> 8) & 0xff) / 255);
  const b = gammaCorrect((n & 0xff) / 255);
  const X = r * 0.4124 + g * 0.3576 + b * 0.1805;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = r * 0.0193 + g * 0.1192 + b * 0.9505;
  const sum = X + Y + Z;
  if (sum === 0) return { x: 0.3127, y: 0.329 };
  return { x: round4(X / sum), y: round4(Y / sum) };
}

/** Convierte coordenadas CIE xy a `#rrggbb` (a brillo pleno, para el swatch). */
export function xyToHex(x: number, y: number): string {
  if (y <= 0) return '#000000';
  const z = 1 - x - y;
  const Y = 1;
  const X = (Y / y) * x;
  const Z = (Y / y) * z;
  let r = X * 3.2406 - Y * 1.5372 - Z * 0.4986;
  let g = -X * 0.9689 + Y * 1.8758 + Z * 0.0415;
  let b = X * 0.0557 - Y * 0.204 + Z * 1.057;
  // Normaliza al canal máximo para no recortar el tono.
  const max = Math.max(r, g, b, 1);
  r = gammaUncorrect(r / max);
  g = gammaUncorrect(g / max);
  b = gammaUncorrect(b / max);
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

function toByte(c: number): string {
  return Math.max(0, Math.min(255, Math.round(c * 255)))
    .toString(16)
    .padStart(2, '0');
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Deriva el `IotColor` de un recurso light de Hue. */
function lightColor(light: Record<string, unknown>): IotColor | null {
  const color = asRecord(light.color);
  const xy = asRecord(color.xy);
  const ct = asRecord(light.color_temperature);
  const hasColor = typeof xy.x === 'number' && typeof xy.y === 'number';
  const mirek = typeof ct.mirek === 'number' ? ct.mirek : null;
  if (!hasColor && mirek === null) return null; // luz solo regulable (sin color)
  // Modo activo: si `color_temperature.mirek_valid` o no hay xy → blanco.
  const inWhiteMode = ct.mirek_valid === true || !hasColor;
  if (inWhiteMode && mirek !== null) {
    return { hex: null, temperatureK: mirekToKelvin(mirek) };
  }
  return { hex: xyToHex(xy.x as number, xy.y as number), temperatureK: null };
}

/** Mapea un recurso `light` de la CLIP API v2 a `IotDevice`. */
export function lightToIotDevice(light: unknown): IotDevice | null {
  const l = asRecord(light);
  const id = typeof l.id === 'string' ? l.id : null;
  if (!id) return null;
  const metadata = asRecord(l.metadata);
  const on = asRecord(l.on);
  const dimming = asRecord(l.dimming);
  return {
    id,
    name: typeof metadata.name === 'string' ? metadata.name : `Hue ${id.slice(0, 8)}`,
    kind: 'light',
    room: null,
    reachable: true,
    on: typeof on.on === 'boolean' ? on.on : null,
    // Hue v2 ya da el brillo en 0-100.
    brightness: typeof dimming.brightness === 'number' ? Math.round(dimming.brightness) : null,
    color: lightColor(l),
    reading: null,
  };
}

/** Mapea la respuesta `{ data: [...] }` de `GET .../resource/light`. */
export function parseLights(data: unknown): IotDevice[] {
  const list = Array.isArray(data) ? data : [];
  return list
    .map(lightToIotDevice)
    .filter((d): d is IotDevice => d !== null);
}

/** Construye el cuerpo del PUT a un light desde una petición de control. */
export function buildLightUpdate(input: UpdateIotStateRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.on !== undefined) body.on = { on: input.on };
  if (input.brightness !== undefined) body.dimming = { brightness: input.brightness };
  if (input.color?.hex !== undefined) body.color = { xy: hexToXy(input.color.hex) };
  else if (input.color?.temperatureK !== undefined) {
    body.color_temperature = { mirek: kelvinToMirek(input.color.temperatureK) };
  }
  return body;
}
