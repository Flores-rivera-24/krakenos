import type { Device } from './inventory.js';
import type { IotDevice } from './iot.js';
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
