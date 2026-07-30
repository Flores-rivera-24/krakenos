import type { IsoDateTime } from './common.js';

/** Muestra puntual de uso de ancho de banda en una interfaz de red. */
export interface TrafficSample {
  timestamp: IsoDateTime;
  /** Bytes por segundo de descarga (entrada). */
  rxBytesPerSec: number;
  /** Bytes por segundo de subida (salida). */
  txBytesPerSec: number;
}

/** Muestra puntual de ancho de banda de un dispositivo concreto (por MAC). */
export interface DeviceTrafficSample {
  mac: string;
  ip: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

/**
 * Resultado de `getTrafficSample()`: la muestra WAN siempre, y opcionalmente el
 * desglose por dispositivo (solo los drivers que lo soportan lo rellenan; el
 * resto devuelve `devices: []`).
 */
export interface TrafficSampleResult {
  wan: { rxBytesPerSec: number; txBytesPerSec: number };
  devices?: DeviceTrafficSample[];
}

/**
 * ¿Puede el driver dar el desglose de tráfico **por dispositivo**? (US-263 lo
 * declaró, US-251 lo implementa para OpenWrt).
 *
 * Son **tres** estados y no un booleano porque hay tres situaciones que la UI
 * tiene que poder distinguir, y confundirlas manda al usuario a pelearse con el
 * problema equivocado:
 *
 * - `supported` — hay dato (o lo habrá en cuanto pase tráfico).
 * - `unsupported` — este driver no tiene ninguna vía. No es culpa de la
 *   configuración y no hay nada que el usuario pueda hacer salvo cambiar de
 *   router.
 * - `requires-setup` — el driver **sí** puede, pero le falta algo en el router.
 *   Es el único de los tres que se arregla, así que la UI dice **cómo**.
 */
export type PerDeviceTrafficStatus = 'supported' | 'unsupported' | 'requires-setup';

/**
 * Qué falta instalar/activar cuando el estado es `requires-setup`. Es una clave
 * **estable y sin copy**: el texto que ve el usuario lo pone la web traducido, y
 * así el agente no acumula cadenas de UI en español. Unión cerrada a propósito —
 * añadir una vía nueva obliga a decidir qué se le dice al usuario.
 */
export type PerDeviceTrafficSetup = 'nlbwmon';

/** Capacidad de desglose por dispositivo, tal y como la ve el consumidor. */
export interface PerDeviceTrafficCapability {
  status: PerDeviceTrafficStatus;
  /** Presente solo si `status === 'requires-setup'`. */
  setup?: PerDeviceTrafficSetup;
}

/** Ventana temporal para las estadísticas históricas de tráfico. */
export type TrafficRange = 'hour' | 'day' | 'week' | 'month';

/** Punto agregado del histórico: media de tasa en el intervalo del bucket. */
export interface TrafficBucket {
  /** Inicio del bucket. */
  timestamp: IsoDateTime;
  /** Media de bytes/seg de descarga en el bucket. */
  rxBytesPerSec: number;
  /** Media de bytes/seg de subida en el bucket. */
  txBytesPerSec: number;
}

/** Estadísticas históricas de tráfico para una ventana temporal. */
export interface TrafficStats {
  range: TrafficRange;
  /** Serie agregada (orden cronológico). */
  buckets: TrafficBucket[];
  /** Bytes totales descargados estimados en la ventana. */
  totalRxBytes: number;
  /** Bytes totales subidos estimados en la ventana. */
  totalTxBytes: number;
}

/** Tráfico histórico agregado de un dispositivo concreto en una ventana. */
export interface DeviceTrafficStats {
  mac: string;
  ip: string;
  /** Etiqueta amigable del dispositivo (de `Device.label`), si tiene. */
  label: string | null;
  /** Bytes totales descargados estimados en la ventana. */
  rxTotal: number;
  /** Bytes totales subidos estimados en la ventana. */
  txTotal: number;
  /** Serie agregada en buckets (orden cronológico) para la mini-gráfica. */
  samples: TrafficBucket[];
}

/**
 * Respuesta de `GET /api/traffic/devices` (US-263).
 *
 * Lleva la capacidad además de los datos porque **una lista vacía es ambigua**: no
 * es lo mismo «tu router no sabe repartir el tráfico por aparato» que «todavía no
 * ha pasado nada». Sin esta distinción la UI culpaba de todo a la configuración del
 * usuario y le mandaba a perseguir el problema equivocado.
 */
export interface DeviceTrafficReport {
  devices: DeviceTrafficStats[];
  /**
   * Capacidad del driver activo (US-263 la declaró; US-251 la hizo real en
   * OpenWrt). Viaja **con los datos** y no en un endpoint aparte, para que la UI
   * no tenga que adivinar justo en el punto donde se ve el vacío.
   */
  perDeviceTraffic: PerDeviceTrafficCapability;
}
