import type { Id } from './common.js';

/** Categoría de dispositivo IoT. */
export type IotDeviceKind = 'light' | 'plug' | 'sensor';

/** Implementaciones de integración IoT disponibles. */
export type IotKind = 'mock' | 'zigbee' | 'matter';

/** Lectura de un sensor (temperatura, humedad…). */
export interface IotReading {
  metric: string;
  value: number;
  unit: string;
}

/** Dispositivo IoT gestionado por el agente. */
export interface IotDevice {
  id: Id;
  name: string;
  kind: IotDeviceKind;
  /** Estancia donde está, si se conoce. */
  room: string | null;
  reachable: boolean;
  /** Encendido/apagado (light/plug); `null` para sensores. */
  on: boolean | null;
  /** Brillo 0-100 (light); `null` si no aplica. */
  brightness: number | null;
  /** Última lectura (sensor); `null` si no aplica. */
  reading: IotReading | null;
}

/** Cambios de estado aplicables a un dispositivo controlable (light/plug). */
export interface UpdateIotStateRequest {
  on?: boolean;
  brightness?: number;
}

/**
 * Integración IoT intercambiable. La implementación real hablaría con
 * Zigbee/Matter/Wi-Fi; `mock` simula en memoria.
 */
export interface IotManager {
  listDevices(): Promise<IotDevice[]>;
  getDevice(id: Id): Promise<IotDevice | null>;
  /** Aplica el cambio de estado a un dispositivo controlable. */
  setState(id: Id, input: UpdateIotStateRequest): Promise<IotDevice>;
}
