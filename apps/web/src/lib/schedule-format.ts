/**
 * Formateo de días y horas compartido por las superficies que programan algo:
 * rutinas (US-167/US-256) y la ventana de vigilancia de las cámaras (US-186).
 *
 * Vivía en `lib/iot-schedules.ts` junto al cliente de una API que ya no existe
 * (US-256 absorbió los horarios IoT); aquí no arrastra ningún endpoint.
 */

/** Etiquetas cortas de los días de la semana (0=Dom … 6=Sáb). */
export const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/**
 * "HH:MM" → minutos del día (0-1439). Una entrada ilegible cae a 0 en vez de
 * producir `NaN`: el valor alimenta el disparador de una rutina, y un `NaN` no
 * lo rechaza el navegador —lo rechaza el borde, con un 400 que el usuario no
 * puede relacionar con el campo de la hora.
 */
export function timeStringToMinute(value: string): number {
  const [h, m] = value.split(':').map(Number);
  const minute = (Number.isFinite(h) ? (h as number) : 0) * 60 + (Number.isFinite(m) ? (m as number) : 0);
  return Math.min(1439, Math.max(0, minute));
}

/** minutos del día → "HH:MM" para un `<input type="time">`. */
export function minuteToTimeString(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Frase de un desfase solar: "Atardecer", "Atardecer −15 min", "Amanecer +30
 * min". El signo va con el menos tipográfico (−), como el resto del copy.
 */
export function formatSunOffset(event: 'sunrise' | 'sunset', offsetMin: number): string {
  const base = event === 'sunrise' ? 'Amanecer' : 'Atardecer';
  if (offsetMin === 0) return base;
  const sign = offsetMin > 0 ? '+' : '−';
  return `${base} ${sign}${Math.abs(offsetMin)} min`;
}
