import type { Device } from './inventory.js';
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
