import type { AccessSchedule, PersonBedtime, PersonDevice, PersonSummary } from '@krakenos/types';
import { evaluateBlocked, groupSchedulesByMac } from '../access/blocked-eval.js';

/**
 * Agrupación **pura** de dispositivos por persona (US-240). Sin E/S ni reloj
 * implícito: recibe las filas y el instante, y devuelve la vista publicable.
 *
 * Tres invariantes que esta función existe para sostener:
 *
 * 1. **El bloqueo se deriva, nunca se lee de la columna** (US-236): un aparato con
 *    horario activo tiene `isBlocked=false` mientras el driver sigue bloqueando.
 *    La decisión la toma `evaluateBlocked`, que es la única fuente correcta.
 * 2. **Ni MAC ni IP salen de aquí.** Esta vista nombra a personas y sus aparatos;
 *    la MAC no aporta nada al caso de uso y es PII que acabaría en un log o en una
 *    captura de pantalla compartida.
 * 3. **La «hora de dormir» no se finge completa.** Se declara a cuántos aparatos
 *    está aplicada de verdad (`appliedTo`): un dispositivo dado de alta después de
 *    guardarla no la tiene, y decir lo contrario es prometer un corte que no
 *    ocurrirá.
 */

/** Fila mínima de dispositivo que necesita la agrupación. */
export interface DeviceRow {
  id: string;
  mac: string;
  label: string | null;
  hostname: string | null;
  online: boolean;
  isBlocked: boolean;
  pausedUntil: Date | null;
  ownerId: string | null;
}

/** Fila mínima de persona. Nunca el email (US-85). */
export interface PersonRow {
  id: string;
  displayName: string;
  role: string;
}

export interface GroupInput {
  devices: DeviceRow[];
  people: PersonRow[];
  /** Horarios **habilitados** de cualquier origen (persona o dispositivo suelto). */
  schedules: AccessSchedule[];
  now: Date;
  /** Nombre del grupo de dispositivos sin dueño (localizable por el llamador). */
  unassignedLabel: string;
}

/** Nombre humano de un dispositivo, nunca su MAC (invariante 2). */
export function deviceDisplayName(d: Pick<DeviceRow, 'id' | 'label' | 'hostname'>): string {
  return d.label ?? d.hostname ?? `Dispositivo ${d.id.slice(-6)}`;
}

/**
 * Resume la «hora de dormir» de una persona a partir de sus horarios con
 * `personId`. Devuelve `null` si no tiene ninguno.
 *
 * ⚠️ Toma la ventana del **primero por orden estable** y cuenta cuántos aparatos la
 * comparten. Si alguien editó uno por su cuenta desde el detalle del dispositivo,
 * `appliedTo` baja y la UI lo dice; **no** se promedia ni se elige «la mayoría»,
 * porque inventar una ventana que no está en ninguna fila es peor que enseñar la
 * discrepancia.
 */
export function summarizeBedtime(personSchedules: AccessSchedule[]): PersonBedtime | null {
  const [first] = personSchedules;
  if (!first) return null;
  const sameWindow = personSchedules.filter(
    (s) =>
      s.startMinute === first.startMinute &&
      s.endMinute === first.endMinute &&
      sameDays(s.days, first.days),
  );
  return {
    enabled: first.enabled,
    days: [...first.days],
    startMinute: first.startMinute,
    endMinute: first.endMinute,
    appliedTo: sameWindow.length,
  };
}

function sameDays(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((v, i) => v === sortedB[i]);
}

/**
 * Agrupa el inventario por dueño. Incluye a las personas **sin dispositivos**
 * (aparecen vacías, con su estado explicado) y, si hay aparatos huérfanos, un
 * grupo «sin asignar» al final.
 */
export function groupByPerson(input: GroupInput): PersonSummary[] {
  const { devices, people, schedules, now, unassignedLabel } = input;
  const schedulesByMac = groupSchedulesByMac(schedules);

  // ownerId → dispositivos ya convertidos a vista, con su bloqueo efectivo resuelto.
  const byOwner = new Map<string | null, PersonDevice[]>();
  for (const d of devices) {
    const state = evaluateBlocked({
      isBlocked: d.isBlocked,
      pausedUntil: d.pausedUntil,
      schedules: schedulesByMac.get(d.mac) ?? [],
      mac: d.mac,
      now,
    });
    const view: PersonDevice = {
      id: d.id,
      name: deviceDisplayName(d),
      online: d.online,
      blocked: state.blocked,
      reasons: state.reasons,
      pausedUntil: state.pausedUntil?.toISOString() ?? null,
    };
    const list = byOwner.get(d.ownerId);
    if (list) list.push(view);
    else byOwner.set(d.ownerId, [view]);
  }

  // personId → sus horarios de persona (los sueltos por dispositivo no cuentan aquí).
  const byPerson = new Map<string, AccessSchedule[]>();
  for (const s of schedules) {
    if (!s.personId) continue;
    const list = byPerson.get(s.personId);
    if (list) list.push(s);
    else byPerson.set(s.personId, [s]);
  }

  const summaries: PersonSummary[] = people.map((p) =>
    buildSummary(p.id, p.displayName, p.role, byOwner.get(p.id) ?? [], byPerson.get(p.id) ?? []),
  );

  const orphans = byOwner.get(null) ?? [];
  if (orphans.length > 0) {
    summaries.push(buildSummary(null, unassignedLabel, null, orphans, []));
  }
  return summaries;
}

function buildSummary(
  userId: string | null,
  name: string,
  role: string | null,
  devices: PersonDevice[],
  personSchedules: AccessSchedule[],
): PersonSummary {
  const sorted = [...devices].sort((a, b) => a.name.localeCompare(b.name));
  // La pausa que se enseña es la que **más tarda en levantarse**: es la respuesta a
  // «¿cuándo vuelve a tener internet?», que es lo que se pregunta de verdad.
  const pausedUntil = sorted.reduce<string | null>(
    (max, d) => (d.pausedUntil && (max === null || d.pausedUntil > max) ? d.pausedUntil : max),
    null,
  );
  return {
    userId,
    name,
    role,
    devices: sorted,
    onlineCount: sorted.filter((d) => d.online).length,
    blockedCount: sorted.filter((d) => d.blocked).length,
    pausedUntil,
    bedtime: userId === null ? null : summarizeBedtime(personSchedules),
  };
}
