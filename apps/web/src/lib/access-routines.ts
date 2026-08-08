import type { AccessSchedule } from '@krakenos/types';
import { DAY_LABELS, minutesToHHMM } from '@/lib/access';

/**
 * Los horarios de acceso (US-108/US-240) vistos como **rutinas**, para que la
 * página de rutinas pueda enseñarlos sin duplicar su editor (US-256).
 *
 * No son reglas del motor y no se convierten en una: una regla es un disparo
 * puntual y esto es una **ventana** que además se reafirma contra el router cada
 * pocos minutos (`access/reaffirm.ts`). Traducirlas a dos reglas «bloquea a las
 * 22:00 / suelta a las 07:00» perdería justo esa propiedad, y un reinicio del
 * router dejaría al menor con internet toda la noche. Se listan y se enlaza a
 * donde se editan.
 *
 * Un horario **de persona** se replica en una fila por aparato, así que sin
 * agrupar, la hora de dormir de alguien con seis aparatos aparecería seis veces.
 * Se agrupa por persona + franja y se declara **a cuántos aparatos llega**, que
 * es el mismo criterio que `appliedTo` en US-240: el número real, no un promedio
 * de una ventana que no está en ninguna fila.
 */

export interface RutinaDeAcceso {
  /**
   * Clave estable para React: el id del primer horario del grupo. **No** la MAC
   * ni el `personId` — una clave viaja a snapshots y a volcados de depuración, y
   * ahí un identificador de red o de persona es una fuga igual que en pantalla.
   */
  clave: string;
  /** A quién o a qué afecta, ya resuelto a nombre. */
  sujeto: string;
  /** Franja legible, "22:00–07:00". */
  franja: string;
  /** Días abreviados, "L M X J V". */
  dias: string;
  /** Cuántos aparatos cubre de verdad. */
  aparatos: number;
  /** ¿Es de persona? Decide a dónde lleva el enlace de edición. */
  dePersona: boolean;
  /** Basta con que una de las filas agrupadas esté activa. */
  habilitada: boolean;
}

export interface NombresDeAcceso {
  /** personId → nombre de la persona. */
  personas?: Map<string, string>;
  /** MAC → etiqueta amable del aparato. */
  aparatos?: Map<string, string>;
  /** Qué poner cuando no se puede nombrar a la persona (rol sin acceso al listado). */
  personaSinNombre: string;
}

/** Agrupa los horarios de acceso en filas presentables, sin publicar MAC. */
export function agruparHorariosDeAcceso(
  schedules: AccessSchedule[],
  nombres: NombresDeAcceso,
): RutinaDeAcceso[] {
  const filas = new Map<string, RutinaDeAcceso>();

  for (const s of schedules) {
    const dias = [...s.days].sort((a, b) => a - b);
    const franja = `${minutesToHHMM(s.startMinute)}–${minutesToHHMM(s.endMinute)}`;
    const diasTexto = dias.map((d) => DAY_LABELS[d] ?? '?').join(' ');
    // La identidad de un horario de persona es la persona + la franja, no la
    // fila: son la misma decisión replicada. La de uno suelto es su aparato.
    // Este agrupador es interno y nunca sale de la función.
    const grupo = s.personId
      ? `p:${s.personId}:${franja}:${diasTexto}`
      : `d:${s.mac}:${franja}:${diasTexto}`;

    const existente = filas.get(grupo);
    if (existente) {
      existente.aparatos += 1;
      existente.habilitada = existente.habilitada || s.enabled;
      continue;
    }

    filas.set(grupo, {
      clave: s.id,
      sujeto: s.personId
        ? (nombres.personas?.get(s.personId) ?? nombres.personaSinNombre)
        : // Nunca la MAC: identifica al aparato en la red y esta lista la ve
          // cualquier rol autenticado. Sin etiqueta se usa el nombre del horario.
          (nombres.aparatos?.get(s.mac) ?? s.name),
      franja,
      dias: diasTexto,
      aparatos: 1,
      dePersona: s.personId !== null,
      habilitada: s.enabled,
    });
  }

  return [...filas.values()];
}
