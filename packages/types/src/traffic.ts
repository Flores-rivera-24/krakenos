import type { IsoDateTime } from './common.js';

/** Muestra puntual de uso de ancho de banda en una interfaz de red. */
export interface TrafficSample {
  timestamp: IsoDateTime;
  /** Bytes por segundo de descarga (entrada). */
  rxBytesPerSec: number;
  /** Bytes por segundo de subida (salida). */
  txBytesPerSec: number;
}
