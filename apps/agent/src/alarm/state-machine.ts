import type { AlarmConfig, AlarmMode, AlarmState } from '@krakenos/types';

/**
 * Máquina de estados **pura** de la alarma (US-188). Sin efectos: toma el estado
 * actual + un evento + `now` y devuelve el nuevo estado, marcando si acaba de
 * **dispararse** (`justTriggered`) para que el servicio ejecute las acciones
 * (sirena/luces/aviso) exactamente una vez. Las cuentas atrás (salida/entrada) se
 * resuelven en `advance()`, llamado por el barrido con la hora real.
 *
 * Transiciones:
 *   disarmed --arm--> arming --(salida)--> armed
 *   armed --trigger--> entry --(entrada)--> triggered   (o triggered directo si entryDelay=0)
 *   {arming,armed,entry,triggered} --disarm--> disarmed
 */

export interface MachineResult {
  state: AlarmState;
  justTriggered: boolean;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Estado desarmado inicial. */
export function disarmedState(now: number): AlarmState {
  return { phase: 'disarmed', mode: null, since: iso(now), countdownEndsAt: null, triggeredBy: null };
}

/** Arma la alarma: entra en `arming` con la cuenta atrás de salida. */
export function arm(mode: AlarmMode, now: number, config: AlarmConfig): AlarmState {
  const exitMs = Math.max(0, config.exitDelaySec) * 1000;
  return {
    phase: exitMs > 0 ? 'arming' : 'armed',
    mode,
    since: iso(now),
    countdownEndsAt: exitMs > 0 ? iso(now + exitMs) : null,
    triggeredBy: null,
  };
}

/** Desarma (siempre válido). */
export function disarm(now: number): AlarmState {
  return disarmedState(now);
}

/**
 * Un sensor/cámara disparó. Solo tiene efecto si está **armada** (en `arming` la
 * cuenta de salida ignora los disparos; en `entry`/`triggered` ya está en curso).
 * Con `entryDelaySec > 0` pasa a `entry` (gracia para desarmar); si no, dispara.
 */
export function trigger(state: AlarmState, by: string, now: number, config: AlarmConfig): MachineResult {
  if (state.phase !== 'armed') return { state, justTriggered: false };
  const entryMs = Math.max(0, config.entryDelaySec) * 1000;
  if (entryMs > 0) {
    return {
      state: {
        phase: 'entry',
        mode: state.mode,
        since: iso(now),
        countdownEndsAt: iso(now + entryMs),
        triggeredBy: by,
      },
      justTriggered: false,
    };
  }
  return {
    state: { phase: 'triggered', mode: state.mode, since: iso(now), countdownEndsAt: null, triggeredBy: by },
    justTriggered: true,
  };
}

/**
 * Avanza las cuentas atrás con la hora real: `arming`→`armed` al agotarse la
 * salida; `entry`→`triggered` al agotarse la entrada (marca `justTriggered`).
 */
export function advance(state: AlarmState, now: number): MachineResult {
  if (state.phase === 'arming' && state.countdownEndsAt && now >= Date.parse(state.countdownEndsAt)) {
    return {
      state: { phase: 'armed', mode: state.mode, since: iso(now), countdownEndsAt: null, triggeredBy: null },
      justTriggered: false,
    };
  }
  if (state.phase === 'entry' && state.countdownEndsAt && now >= Date.parse(state.countdownEndsAt)) {
    return {
      state: {
        phase: 'triggered',
        mode: state.mode,
        since: iso(now),
        countdownEndsAt: null,
        triggeredBy: state.triggeredBy,
      },
      justTriggered: true,
    };
  }
  return { state, justTriggered: false };
}

/** ¿La alarma está vigilando activamente (puede disparar)? */
export function isActive(state: AlarmState): boolean {
  return state.phase === 'armed' || state.phase === 'entry' || state.phase === 'triggered';
}
