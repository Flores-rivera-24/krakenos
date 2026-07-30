import type { IsoDateTime } from './common.js';

/**
 * Bienestar digital (US-184): informe de uso de internet por persona, agregando
 * el tráfico por dispositivo (US-46) sobre el dueño del aparato (`Device.ownerId`,
 * US-179). La ventana máxima es una semana (los rollups por dispositivo se
 * retienen 7 días).
 */
export type WellbeingRange = 'day' | 'week';

/** Punto de la serie de uso (bytes totales rx+tx en el bucket). */
export interface UsageBucket {
  timestamp: IsoDateTime;
  bytes: number;
}

/** Uso de internet agregado de una persona (o de los aparatos sin dueño). */
export interface PersonUsage {
  /** Id de la persona dueña, o `null` para los dispositivos sin asignar. */
  userId: string | null;
  /** Nombre a mostrar (persona o «Sin asignar»). */
  name: string;
  /** Bytes de descarga estimados en la ventana. */
  rxBytes: number;
  /** Bytes de subida estimados en la ventana. */
  txBytes: number;
  /** Bytes totales (rx+tx) en la ventana. */
  totalBytes: number;
  /** Nº de dispositivos de esta persona con tráfico en la ventana. */
  deviceCount: number;
  /** Serie agregada en buckets (orden cronológico). */
  buckets: UsageBucket[];
}

/** Respuesta del informe de uso por persona (`GET /api/wellbeing/usage`). */
export interface WellbeingUsage {
  range: WellbeingRange;
  /** Personas con uso en la ventana (orden descendente por total). */
  people: PersonUsage[];
  /**
   * ¿El driver activo reporta el tráfico **por dispositivo**? (US-263). Es la
   * fuente única de este informe: sin ella `people` sale vacío **siempre**, por
   * mucho dueño que se asigne. Hoy solo el `mock`. Arreglo de fondo: US-251.
   */
  perDeviceTrafficSupported: boolean;
  /**
   * Cuántos dispositivos del inventario tienen dueño asignado. Permite distinguir
   * «no hay dueños» de «hay dueños pero aún no hay datos» sin adivinar en la UI.
   */
  devicesWithOwner: number;
}
