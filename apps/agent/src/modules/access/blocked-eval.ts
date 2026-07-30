import type { AccessSchedule, BlockReason } from '@krakenos/types';
import { activeBlockedMacs } from './schedule-eval.js';

/**
 * «¿Está bloqueado este dispositivo ahora, y por qué?» — evaluación **pura** del
 * bloqueo efectivo (US-236). Cierra la *deuda de claridad* que arrastraba el
 * proyecto: la respuesta vivía repartida entre tres fuentes y se recomponía a mano
 * en cada sitio que la necesitaba.
 *
 * **Un dispositivo está sin internet si se cumple CUALQUIERA de estas tres**, y las
 * tres son independientes:
 *
 * | Fuente | Dónde vive |
 * |---|---|
 * | Bloqueo manual | `Device.isBlocked` |
 * | Horario | derivado de `AccessSchedule` |
 * | Pausa | `Device.pausedUntil` |
 *
 * Hay un cuarto estado **sombra** (`access.managedBlocked`) que registra lo que se
 * aplicó al driver; NO es una fuente de verdad para «¿está bloqueado?» y por eso no
 * entra aquí.
 *
 * ⚠️ **Dos trampas que este módulo existe para evitar:**
 * 1. **`Device.isBlocked` NO es «está bloqueado»**: con un horario activo,
 *    `setBlocked(id,false)` deja la columna en `false` mientras el driver sigue
 *    bloqueando. Publicar esa columna sería mentir.
 * 2. **`pausedUntil` no se limpia al expirar** (solo `resume()` lo pone a `null`):
 *    leerlo como `!= null` da un positivo permanente. Aquí **siempre** se compara
 *    contra `now`.
 *
 * No confundir con `AccessScheduleService.isBlockedNow`, que responde a otra
 * pregunta —«¿lo mantienen bloqueado horario o pausa?»— y **omite el manual a
 * propósito**, porque su consumidor (desbloquear a mano) ya conoce el manual.
 */

/**
 * Por qué está sin internet un dispositivo. Un bloqueo puede tener varias razones
 * a la vez. El tipo vive en `@krakenos/types` (US-240) porque también viaja a la
 * web en la vista de personas; se re-exporta aquí por comodidad de los consumidores
 * del evaluador.
 */
export type { BlockReason };

export interface BlockedState {
  /** Bloqueo **efectivo**: manual OR horario OR pausa. */
  blocked: boolean;
  /** Todas las razones que aplican, en orden estable. Vacío si no está bloqueado. */
  reasons: BlockReason[];
  /** Fin de la pausa, si `reasons` incluye `paused`. */
  pausedUntil: Date | null;
}

export interface BlockedInput {
  /** `Device.isBlocked` (bloqueo manual). */
  isBlocked: boolean;
  /** `Device.pausedUntil` crudo de la DB (puede estar en el pasado). */
  pausedUntil: Date | null;
  /** Horarios **de este dispositivo** (ya filtrados por MAC). */
  schedules: AccessSchedule[];
  mac: string;
  now: Date;
}

/** Orden estable de las razones, para que el payload publicado no oscile. */
const ORDER: BlockReason[] = ['manual', 'schedule', 'paused'];

/** Evalúa el bloqueo efectivo de un dispositivo. Puro: sin E/S ni reloj implícito. */
export function evaluateBlocked(input: BlockedInput): BlockedState {
  const reasons = new Set<BlockReason>();

  if (input.isBlocked) reasons.add('manual');

  // La pausa solo cuenta mientras no haya expirado (trampa 2).
  const pausaViva = input.pausedUntil !== null && input.pausedUntil > input.now;
  if (pausaViva) reasons.add('paused');

  if (activeBlockedMacs(input.schedules, input.now).has(input.mac)) reasons.add('schedule');

  const ordered = ORDER.filter((r) => reasons.has(r));
  return {
    blocked: ordered.length > 0,
    reasons: ordered,
    pausedUntil: pausaViva ? input.pausedUntil : null,
  };
}

/**
 * Agrupa horarios por MAC. Lo usa el evaluador en lote para no hacer una consulta
 * por dispositivo: se leen **todos** los horarios activos de una vez y se reparten.
 */
export function groupSchedulesByMac(schedules: AccessSchedule[]): Map<string, AccessSchedule[]> {
  const byMac = new Map<string, AccessSchedule[]>();
  for (const s of schedules) {
    const list = byMac.get(s.mac);
    if (list) list.push(s);
    else byMac.set(s.mac, [s]);
  }
  return byMac;
}

/** Texto corto y estable de la razón principal (para el payload de MQTT y la UI). */
export function primaryReason(state: BlockedState): BlockReason | null {
  return state.reasons[0] ?? null;
}
