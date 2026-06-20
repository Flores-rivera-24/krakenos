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

/** Ventana temporal para las estadísticas históricas de tráfico. */
export type TrafficRange = 'hour' | 'day' | 'week';

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
