import type { IotDevice, UpdateIotStateRequest } from '@krakenos/types';
import type { TuyaDeviceConfig } from './tuya.store.js';

/**
 * Parsers/builders **puros** del protocolo Tuya local (DPS = "data points").
 * Sin red: se testean con fixtures. La I/O (TCP 6668 + AES) vive en
 * `TuyaIotManager` + el transporte (`tuya.transport`).
 *
 * Los focos Tuya/Amazon (EASYTAO y similares) usan dos esquemas de DPS según la
 * generación del firmware:
 *   - **nuevo**: DPS 20 = on/off · DPS 22 = brillo · DPS 21 = modo de color
 *   - **viejo**: DPS  1 = on/off · DPS  2 = brillo · DPS  3 = modo de color
 * El brillo del protocolo va en el rango **10-1000**; el contrato IoT lo expone
 * como **0-100**.
 */

/** DPS de on/off (nuevo/viejo). */
export const DP_ON_NEW = '20';
export const DP_ON_OLD = '1';
/** DPS de brillo (nuevo/viejo). */
export const DP_BRIGHT_NEW = '22';
export const DP_BRIGHT_OLD = '2';
/** DPS de modo de color (nuevo/viejo) — `white` | `colour`. */
export const DP_MODE_NEW = '21';
export const DP_MODE_OLD = '3';

/** Rango de brillo del protocolo Tuya. */
const DPS_BRIGHT_MIN = 10;
const DPS_BRIGHT_MAX = 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Brillo de contrato (0-100) → DPS Tuya (10-1000). `scaleBrightnessToDps(0)=10`, `(100)=1000`. */
export function scaleBrightnessToDps(pct: number): number {
  const scaled = Math.round(DPS_BRIGHT_MIN + (clamp(pct, 0, 100) / 100) * (DPS_BRIGHT_MAX - DPS_BRIGHT_MIN));
  return clamp(scaled, DPS_BRIGHT_MIN, DPS_BRIGHT_MAX);
}

/** Brillo DPS Tuya (10-1000) → contrato (0-100). `scaleBrightnessFromDps(500)=50`. */
export function scaleBrightnessFromDps(raw: number): number {
  return clamp(Math.round(raw / 10), 0, 100);
}

/** Lee el primer DPS presente entre `keys` (acepta claves número o string). */
function readDp(dps: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (dps[key] !== undefined) return dps[key];
  }
  return undefined;
}

/**
 * Mapea el estado DPS leído de un foco Tuya a un `IotDevice`. El color se ignora
 * por ahora (solo se conserva el on/off y el brillo); siempre `kind: 'light'`.
 */
export function dpsToIotDevice(config: TuyaDeviceConfig, dps: Record<string, unknown>): IotDevice {
  const onRaw = readDp(dps, [DP_ON_NEW, DP_ON_OLD]);
  const brightRaw = readDp(dps, [DP_BRIGHT_NEW, DP_BRIGHT_OLD]);

  return {
    id: config.deviceId,
    name: config.name || `Tuya ${config.deviceId}`,
    kind: 'light',
    room: null,
    reachable: true,
    on: typeof onRaw === 'boolean' ? onRaw : null,
    brightness: typeof brightRaw === 'number' ? scaleBrightnessFromDps(brightRaw) : null,
    // El modo de color (DP_MODE_*) se ignora por ahora; el contrato lo deja en null.
    color: null,
    reading: null,
  };
}

/**
 * Construye el payload DPS **parcial** para un cambio de estado: solo incluye los
 * DPS que se están actualizando. Usa el esquema nuevo (20/22), el más común en los
 * focos genéricos actuales. `on` → DPS 20, `brightness` → DPS 22 (0-100 → 10-1000).
 */
export function stateToTuyaPayload(state: UpdateIotStateRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (state.on !== undefined) payload[DP_ON_NEW] = state.on;
  if (state.brightness !== undefined) payload[DP_BRIGHT_NEW] = scaleBrightnessToDps(state.brightness);
  return payload;
}
