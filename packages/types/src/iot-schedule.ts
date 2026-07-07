import type { IsoDateTime } from './common.js';

/**
 * Momento de disparo de un horario IoT (US-168). O una **hora fija** (minutos
 * desde medianoche) o relativo al **sol** (amanecer/atardecer) con un desfase en
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

/** Alta de horario IoT (`POST /api/iot-schedules`). */
export interface CreateIotScheduleRequest {
  name: string;
  enabled?: boolean;
  days: number[];
  time: IotScheduleTime;
  target: IotScheduleTarget;
}

/** Cambios parciales de un horario IoT (`PATCH /api/iot-schedules/:id`). */
export interface UpdateIotScheduleRequest {
  name?: string;
  enabled?: boolean;
  days?: number[];
  time?: IotScheduleTime;
  target?: IotScheduleTarget;
}
