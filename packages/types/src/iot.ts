import type { Id } from './common.js';

/** Categoría de dispositivo IoT. */
export type IotDeviceKind = 'light' | 'plug' | 'sensor';

/** Implementaciones de integración IoT disponibles. */
export type IotKind = 'mock' | 'zigbee' | 'matter' | 'hue' | 'govee' | 'tuya';

/** Lectura de un sensor (temperatura, humedad…). */
export interface IotReading {
  metric: string;
  value: number;
  unit: string;
}

/**
 * Color de una luz. Una luz con color tiene `IotColor`; las que no lo soportan
 * (enchufes, luces solo-blanco-fijo) lo dejan en `null`. Modo color → `hex`;
 * modo blanco regulable → `temperatureK` (en Kelvin). Solo uno está activo.
 */
export interface IotColor {
  /** Color RGB en hex (`#rrggbb`) cuando la luz está en modo color; `null` si no. */
  hex: string | null;
  /** Temperatura de color en Kelvin (modo blanco); `null` si está en modo color. */
  temperatureK: number | null;
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
  /** Color (luces con color); `null` si la luz no soporta color o no es luz. */
  color: IotColor | null;
  /** Última lectura (sensor); `null` si no aplica. */
  reading: IotReading | null;
}

/** Cambios de estado aplicables a un dispositivo controlable (light/plug). */
export interface UpdateIotStateRequest {
  on?: boolean;
  brightness?: number;
  /** Cambia el color (hex `#rrggbb`) o la temperatura (Kelvin); excluyentes. */
  color?: { hex?: string; temperatureK?: number };
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
