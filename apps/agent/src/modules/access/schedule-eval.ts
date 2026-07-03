import type { AccessSchedule } from '@krakenos/types';

/**
 * Evaluación **pura** de los horarios de acceso (US-108). Sin E/S: dados los
 * horarios y un instante (día de la semana + minuto del día), dice qué MACs deben
 * estar bloqueadas ahora. Testeable exhaustivamente, incluida la ventana que cruza
 * la medianoche (p. ej. 21:00→07:00).
 */

export const MINUTES_IN_DAY = 24 * 60;

/** ¿Está activa la ventana de `schedule` en (`dow`, `minute`)? */
export function isActiveAt(schedule: AccessSchedule, dow: number, minute: number): boolean {
  if (!schedule.enabled || schedule.days.length === 0) return false;
  const { startMinute: start, endMinute: end, days } = schedule;

  // Ventana normal dentro del mismo día: [start, end).
  if (end > start) {
    return days.includes(dow) && minute >= start && minute < end;
  }

  // Ventana que cruza medianoche (end ≤ start): [start, 24:00) del día `dow`
  // (si empezó hoy) O [0, end) arrastrada desde el día anterior.
  const startedToday = days.includes(dow) && minute >= start;
  const prevDow = (dow + 6) % 7;
  const carriedFromYesterday = days.includes(prevDow) && minute < end;
  return startedToday || carriedFromYesterday;
}

/** Extrae (dow, minute) de una fecha en hora local del servidor. */
export function dowAndMinute(now: Date): { dow: number; minute: number } {
  return { dow: now.getDay(), minute: now.getHours() * 60 + now.getMinutes() };
}

/** Conjunto de MACs que deben estar bloqueadas por horario en el instante `now`. */
export function activeBlockedMacs(schedules: AccessSchedule[], now: Date): Set<string> {
  const { dow, minute } = dowAndMinute(now);
  const macs = new Set<string>();
  for (const s of schedules) {
    if (isActiveAt(s, dow, minute)) macs.add(s.mac);
  }
  return macs;
}
