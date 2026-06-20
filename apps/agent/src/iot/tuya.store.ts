import type { Identifiable, JsonStore } from '../store/json-store.js';

/** Versión del protocolo Tuya local. */
export type TuyaProtocolVersion = '3.1' | '3.3' | '3.4';

/**
 * Configuración de un foco Tuya físico. La `localKey` es la clave AES (16 bytes)
 * **única por dispositivo** que entrega el portal Tuya Developer; por eso no va
 * en `.env` (es por dispositivo, no global) sino en un store por fichero.
 */
export interface TuyaDeviceConfig {
  /** ID del dispositivo (de la app Smart Life / portal Tuya). */
  deviceId: string;
  /** Clave AES de 16 bytes (del portal Tuya Developer). Credencial sensible. */
  localKey: string;
  /** IP local del dispositivo en la red. */
  ip: string;
  /** Nombre legible (libre). */
  name: string;
  /** Protocolo Tuya; por defecto `3.3`. */
  version?: TuyaProtocolVersion;
}

/**
 * Registro persistido: un `TuyaDeviceConfig` identificado por `deviceId`. El
 * `JsonStore` indexa por `id`, así que `id === deviceId` (un registro por
 * dispositivo físico).
 */
export interface TuyaDeviceRecord extends TuyaDeviceConfig, Identifiable {}

/** Store de configuración de dispositivos Tuya (memoria o fichero JSON). */
export type TuyaStore = JsonStore<TuyaDeviceRecord>;

/** Construye el registro persistible (`id === deviceId`) desde una config. */
export function toTuyaRecord(config: TuyaDeviceConfig): TuyaDeviceRecord {
  return { ...config, id: config.deviceId };
}

/** Vista pública del registro: **nunca** expone la `localKey`. */
export function toPublicTuyaDevice(record: TuyaDeviceRecord): Omit<TuyaDeviceConfig, 'localKey'> {
  const { deviceId, ip, name, version } = record;
  return { deviceId, ip, name, ...(version ? { version } : {}) };
}
