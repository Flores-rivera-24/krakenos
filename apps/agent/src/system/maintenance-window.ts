/**
 * Ventana de mantenimiento para la actualización one-click (US-190). Franja
 * horaria opcional "HH:MM-HH:MM" (hora local) dentro de la cual se permite
 * aplicar una actualización, para no reiniciar el hogar en mitad del día.
 *
 * Puro y sin estado: recibe la fecha (inyectable) para poder testear el cruce de
 * medianoche sin depender del reloj real.
 */

export interface MaintenanceWindow {
  /** Minuto de inicio desde medianoche [0, 1439]. */
  startMin: number;
  /** Minuto de fin desde medianoche [0, 1439]. */
  endMin: number;
}

/** Parsea "HH:MM-HH:MM" a minutos. Devuelve `null` si vacío o mal formado. */
export function parseMaintenanceWindow(raw: string | null | undefined): MaintenanceWindow | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [sh, sm, eh, em] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  // Rango degenerado (inicio == fin) no define ninguna franja útil → sin ventana.
  if (startMin === endMin) return null;
  return { startMin, endMin };
}

/**
 * ¿Está `date` dentro de la ventana? Sin ventana (`null`) siempre permite. Soporta
 * el cruce de medianoche: "22:00-06:00" cubre la noche (inicio > fin → dos tramos).
 */
export function isWithinWindow(window: MaintenanceWindow | null, date: Date): boolean {
  if (!window) return true;
  const nowMin = date.getHours() * 60 + date.getMinutes();
  const { startMin, endMin } = window;
  return startMin < endMin
    ? nowMin >= startMin && nowMin < endMin
    : nowMin >= startMin || nowMin < endMin;
}
