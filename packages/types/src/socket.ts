import type { Device } from './inventory.js';
import type { IotDevice } from './iot.js';
import type { HomeMode, HomeModeSource } from './presence.js';
import type { TrafficSample } from './traffic.js';

/**
 * Eventos emitidos por el agente hacia el cliente vía Socket.io.
 * El tipado se comparte para que cliente y servidor no diverjan.
 */
export interface ServerToClientEvents {
  /** Un dispositivo apareció o cambió de estado. */
  'inventory:device-updated': (device: Device) => void;
  /** Un dispositivo pasó a offline o fue eliminado. */
  'inventory:device-removed': (deviceId: string) => void;
  /** Snapshot completo tras (re)conexión del cliente. */
  'inventory:snapshot': (devices: Device[]) => void;
  /** Histórico reciente de tráfico tras (re)conexión del cliente. */
  'traffic:history': (samples: TrafficSample[]) => void;
  /** Nueva muestra de tráfico en tiempo real. */
  'traffic:sample': (sample: TrafficSample) => void;
  /** Estado completo de dispositivos IoT tras (re)conexión. */
  'iot:snapshot': (devices: IotDevice[]) => void;
  /** Un dispositivo IoT cambió de estado. */
  'iot:device-updated': (device: IotDevice) => void;
  /**
   * El modo del hogar o la presencia cambiaron (US-169). El payload solo lleva
   * el modo (estado global); la lista de personas es sensible y **no** se
   * difunde por socket — el cliente re-consulta `GET /api/presence`, que acota
   * por rol.
   */
  'presence:updated': (state: { mode: HomeMode; modeSource: HomeModeSource }) => void;
  /**
   * La sesión del socket dejó de ser válida (access token expirado o firmado con
   * una clave ya retirada). El cliente debe refrescar y reconectar (US-80, F7).
   */
  'auth:expired': () => void;
}

/** Eventos emitidos por el cliente hacia el agente. */
export interface ClientToServerEvents {
  /** Solicita un barrido inmediato bajo demanda. */
  'inventory:rescan': () => void;
}

/** Nombre del room de Socket.io que recibe actualizaciones de inventario. */
export const INVENTORY_ROOM = 'inventory';

/** Nombre del room de Socket.io que recibe muestras de tráfico. */
export const TRAFFIC_ROOM = 'traffic';

/** Nombre del room de Socket.io que recibe cambios de dispositivos IoT. */
export const IOT_ROOM = 'iot';
