import type { IsoDateTime } from './common.js';

/**
 * ⚠️ **Contrato de archivo.** Los horarios IoT (US-168) los absorbió el motor de
 * rutinas (US-256): ya no hay endpoints, ni UI, ni barrido. Estos tipos siguen
 * aquí porque la absorción **lee** la tabla `IotSchedule` al arrancar para
 * traducir lo que hubiera en instalaciones existentes. Se van con la tabla.
 *
 * Por eso ya no están `CreateIotScheduleRequest` ni `UpdateIotScheduleRequest`:
 * describían dos rutas que no existen, y un tipo de petición sin ruta es una
 * promesa de API que nadie puede cumplir.
 */

/**
 * Momento de disparo de un horario IoT. O una **hora fija** (minutos desde
 * medianoche) o relativo al **sol** (amanecer/atardecer) con un desfase en
 * minutos (p. ej. atardecer -15). El sol se calcula localmente con la lat/long
 * del hogar, sin llamadas externas.
 */
export type IotScheduleTime =
  | { kind: 'fixed'; minute: number }
  | { kind: 'sunrise'; offsetMin: number }
  | { kind: 'sunset'; offsetMin: number };

/** Objetivo de un horario: un dispositivo IoT o una escena (US-166/168). */
export type IotScheduleTarget =
  | { type: 'device'; deviceId: string; on?: boolean; brightness?: number }
  | { type: 'scene'; sceneId: string };

/**
 * Horario para IoT/escenas (US-168): dispara una acción en días concretos a una
 * hora fija o solar. A diferencia de los horarios de acceso (US-108, ventanas de
 * bloqueo), esto es un **disparo puntual** en el borde de la hora programada.
 */
export interface IotSchedule {
  id: string;
  name: string;
  enabled: boolean;
  /** Días de la semana (0-6, Dom-Sáb) en los que aplica. */
  days: number[];
  time: IotScheduleTime;
  target: IotScheduleTarget;
  createdAt: IsoDateTime;
}
