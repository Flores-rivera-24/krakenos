import type { IotSchedule, IotScheduleTime } from '@krakenos/types';
import { sunEventLocalMinutes } from '../../iot/solar.js';

/** Ubicación del hogar para el cálculo solar (grados), o `null` si no está configurada. */
export interface HomeLocation {
  lat: number;
  lon: number;
}

function clampMinute(m: number): number {
  return Math.min(1439, Math.max(0, m));
}

/**
 * Minuto del día (0-1439, hora local) en que dispara un horario en la fecha dada,
 * o `null` si no aplica (evento solar sin ubicación configurada, o día polar sin
 * amanecer/atardecer). Para eventos solares aplica el desfase y acota a [0,1439].
 */
export function triggerMinuteFor(
  time: IotScheduleTime,
  date: Date,
  home: HomeLocation | null,
): number | null {
  if (time.kind === 'fixed') return clampMinute(time.minute);
  if (!home) return null; // sin ubicación no hay cálculo solar
  const base = sunEventLocalMinutes(date, home.lat, home.lon, time.kind);
  if (base === null) return null; // día polar
  return clampMinute(base + time.offsetMin);
}

/**
 * ¿Dispara este horario en el borde entre `prev` y `now`? Modelo por **cruce**:
 * dispara exactamente cuando el barrido cruza el minuto programado (`trigger` en
 * `(prevMin, nowMin]`), una sola vez. Al arrancar, con `prev === now`, no dispara
 * nada retroactivo (no enciende luces "atrasadas"). Maneja el cruce de medianoche.
 */
export function isDueAt(
  schedule: IotSchedule,
  prev: Date,
  now: Date,
  home: HomeLocation | null,
): boolean {
  if (!schedule.enabled) return false;
  if (!schedule.days.includes(now.getDay())) return false;

  const trigger = triggerMinuteFor(schedule.time, now, home);
  if (trigger === null) return false;

  const prevMin = prev.getHours() * 60 + prev.getMinutes();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (prevMin === nowMin) return false; // mismo minuto → ya considerado
  if (prevMin < nowMin) return trigger > prevMin && trigger <= nowMin;
  // Cruce de medianoche: intervalo (prevMin, 1440) ∪ [0, nowMin].
  return trigger > prevMin || trigger <= nowMin;
}

/** Horarios que disparan en el borde `prev`→`now`. */
export function dueSchedules(
  schedules: IotSchedule[],
  prev: Date,
  now: Date,
  home: HomeLocation | null,
): IotSchedule[] {
  return schedules.filter((s) => isDueAt(s, prev, now, home));
}
