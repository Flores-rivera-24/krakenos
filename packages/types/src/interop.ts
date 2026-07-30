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
  /**
   * MQTT Discovery de Home Assistant (US-213): publica configs **retained** bajo
   * `homeassistant/…/config` para que HA descubra los dispositivos solo. Off por
   * defecto. **Publicar estados ≠ aceptar órdenes** (ver `control`).
   */
  discovery: boolean;
  /**
   * Control entrante (US-213): suscribe a `<prefijo>/iot/<id>/set` y aplica el
   * comando (`setState`, anti-bucle `origin:'mqtt'`, auditado). Off por defecto y
   * **separado** de `discovery`: publicar estados no implica aceptar órdenes.
   */
  control: boolean;
  /**
   * Control entrante de **pausa de internet** (US-236): expone en HA un botón
   * «pausar internet 30 min» por dispositivo. Off por defecto y **con toggle
   * propio**, distinto de `control`.
   *
   * ⚠️ No se fusiona con `control` a propósito: «HA puede tocar mis aparatos IoT»
   * y «HA puede cortarle internet a alguien de casa» son permisos distintos. La
   * ruta HTTP equivalente (`POST /api/access/pause`) es admin-only y rechaza
   * tokens de API; el broker **no tiene sujeto**, así que cada acción sensible
   * necesita su propio consentimiento explícito y queda auditada con actor `mqtt`.
   */
  pauseControl: boolean;
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
  discovery?: boolean;
  control?: boolean;
  pauseControl?: boolean;
}

/** Estado en vivo de la publicación MQTT. */
export interface MqttPublishStatus {
  enabled: boolean;
  connected: boolean;
  lastPublishAt: IsoDateTime | null;
  /** Último error (p. ej. broker inalcanzable o bloqueado por egress), o `null`. */
  lastError: string | null;
}
