import type { Id } from './common.js';

/**
 * Puente Matter (US-171): KrakenOS se expone a Alexa/Google/Apple Home como un
 * **bridge Matter** en la LAN (sin nube). Cada dispositivo IoT elegido se publica
 * como un endpoint Matter del tipo que corresponda a sus capacidades.
 */

/** Tipo de endpoint Matter según las capacidades del aparato. */
export type MatterEndpointType = 'onoff' | 'dimmable' | 'color';

/** Los tipos válidos (para derivar schemas/enums sin duplicar la unión). */
export const MATTER_ENDPOINT_TYPES = ['onoff', 'dimmable', 'color'] as const;

/** Un dispositivo IoT publicado en el puente como endpoint Matter. */
export interface MatterBridgeEndpoint {
  deviceId: Id;
  name: string;
  type: MatterEndpointType;
}

/** Dispositivo candidato a exponer (mapeable a un endpoint Matter). */
export interface MatterBridgeCandidate {
  deviceId: Id;
  name: string;
  type: MatterEndpointType;
  /** Ya está en el conjunto expuesto. */
  exposed: boolean;
}

/**
 * Estado del puente Matter para la UI (`GET /api/matter-bridge`). El puente está
 * **desactivado por defecto** (opt-in explícito). Con `enabled`, el usuario
 * comisiona el hub escaneando `qrDataUrl` (o tecleando `manualPairingCode`) en su
 * app de asistente; `commissioned` refleja si algún fabric ya lo emparejó.
 */
export interface MatterBridgeState {
  /** Opt-in: el puente está activado por el usuario. */
  enabled: boolean;
  /** El stack Matter está corriendo (activo y sin error de arranque). */
  running: boolean;
  /** Al menos un asistente (fabric) ha emparejado el puente. */
  commissioned: boolean;
  /** Nº de fabrics (asistentes) emparejados. */
  fabricCount: number;
  /** Payload del QR de comisionado (cadena `MT:…`); `null` si no está corriendo. */
  qrCode: string | null;
  /** Imagen PNG (data URL) del QR para pintar directamente; `null` si no aplica. */
  qrDataUrl: string | null;
  /** Código de emparejamiento manual (11 dígitos) como alternativa al QR. */
  manualPairingCode: string | null;
  /** Endpoints actualmente publicados (dispositivos expuestos y mapeables). */
  endpoints: MatterBridgeEndpoint[];
  /** Catálogo de dispositivos que se pueden exponer, con su estado. */
  candidates: MatterBridgeCandidate[];
}

/** Cambios de configuración del puente (`PUT /api/matter-bridge`). */
export interface UpdateMatterBridgeRequest {
  /** Activa/desactiva el puente (opt-in). */
  enabled?: boolean;
  /** Conjunto de ids de dispositivos a exponer (reemplaza el actual). */
  exposedDeviceIds?: Id[];
}
