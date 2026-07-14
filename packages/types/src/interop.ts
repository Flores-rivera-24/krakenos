import type { IsoDateTime } from './common.js';

/**
 * Publicación de estados a un broker MQTT **local** (US-174). Opt-in, off por
 * defecto. Permite integrar KrakenOS con Home Assistant/Node-RED sin darles la
 * contraseña: se publican estados de IoT, energía y un resumen del inventario. La
 * contraseña del broker se cifra en reposo (secretbox) y **nunca** sale por la API.
 */
export interface MqttPublishConfig {
  enabled: boolean;
  /** URL del broker, p. ej. `mqtt://192.168.1.10:1883` (validada contra egress). */
  url: string;
  username: string;
  /** `true` si hay contraseña guardada (su valor nunca se devuelve). */
  hasPassword: boolean;
  /** Prefijo de los topics, p. ej. `krakenos`. */
  topicPrefix: string;
  /** Cada cuántos segundos se publica el estado. */
  intervalSec: number;
}

/** Cuerpo de `PUT /api/interop/mqtt`. Campos omitidos = sin cambio. */
export interface UpdateMqttPublishRequest {
  enabled?: boolean;
  url?: string;
  username?: string;
  /** `null` borra la contraseña; una cadena la fija; omitir = conservar. */
  password?: string | null;
  topicPrefix?: string;
  intervalSec?: number;
}

/** Estado en vivo de la publicación MQTT. */
export interface MqttPublishStatus {
  enabled: boolean;
  connected: boolean;
  lastPublishAt: IsoDateTime | null;
  /** Último error (p. ej. broker inalcanzable o bloqueado por egress), o `null`. */
  lastError: string | null;
}
