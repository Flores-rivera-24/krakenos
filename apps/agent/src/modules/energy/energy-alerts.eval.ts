import type { EnergyAlertRule } from '@krakenos/types';

/** Cooldown mínimo entre disparos de la misma regla sostenida (anti-spam). */
export const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Banda de histéresis (US-183): tras disparar una regla `sustained-power`, la
 * potencia debe caer por debajo de `threshold × HYSTERESIS` para rearmar la
 * alerta. Evita el parpadeo de disparos si la potencia oscila alrededor del umbral.
 */
export const HYSTERESIS = 0.9;

/** Estado en memoria del evaluador para una regla concreta. */
export interface RuleState {
  /** Instante (ms) en que la potencia superó el umbral por primera vez (sostenido). */
  aboveSinceMs: number | null;
  /** La alerta está disparada y aún no ha rearmado (histéresis). */
  firing: boolean;
  /** Último disparo (ms), para el cooldown. */
  lastFiredMs: number | null;
  /** Día (YYYY-MM-DD) en que ya disparó una regla `daily-energy` (una vez/día). */
  firedDay: string | null;
}

/** Estado inicial de una regla (nunca ha disparado). */
export function initialState(): RuleState {
  return { aboveSinceMs: null, firing: false, lastFiredMs: null, firedDay: null };
}

/** Clave de día local (YYYY-MM-DD) para el reinicio diario de `daily-energy`. */
export function dayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/**
 * Decide si una regla debe disparar dada la magnitud observada `value` (W para
 * `sustained-power`, Wh acumulados hoy para `daily-energy`) en el instante `now`.
 * Devuelve el nuevo estado y `fire` (verdadero solo en el instante del cruce).
 * Pura: toda la temporalidad entra por `now`/`state` (fácil de testear).
 */
export function evaluate(
  state: RuleState,
  rule: Pick<EnergyAlertRule, 'metric' | 'threshold' | 'sustainMinutes'>,
  value: number,
  now: Date,
): { fire: boolean; state: RuleState } {
  const nowMs = now.getTime();

  if (rule.metric === 'daily-energy') {
    const today = dayKey(now);
    // Nuevo día: rearma (una alerta por día como máximo).
    const firedDay = state.firedDay === today ? today : null;
    if (value >= rule.threshold && firedDay !== today) {
      return { fire: true, state: { ...state, firedDay: today } };
    }
    return { fire: false, state: { ...state, firedDay } };
  }

  // sustained-power: la potencia debe mantenerse por encima `sustainMinutes`.
  const above = value > rule.threshold;
  if (!above) {
    // Rearma solo cuando cae bajo la banda de histéresis.
    const firing = value > rule.threshold * HYSTERESIS ? state.firing : false;
    return { fire: false, state: { ...state, aboveSinceMs: null, firing } };
  }

  const aboveSinceMs = state.aboveSinceMs ?? nowMs;
  const sustainedMs = nowMs - aboveSinceMs;
  const cooldownPassed = state.lastFiredMs === null || nowMs - state.lastFiredMs >= ALERT_COOLDOWN_MS;
  const longEnough = sustainedMs >= rule.sustainMinutes * 60_000;

  if (longEnough && !state.firing && cooldownPassed) {
    return { fire: true, state: { ...state, aboveSinceMs, firing: true, lastFiredMs: nowMs } };
  }
  return { fire: false, state: { ...state, aboveSinceMs } };
}
