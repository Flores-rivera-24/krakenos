/**
 * Lockout del PIN de desarme de la alarma (AUD3-03, US-227).
 *
 * `POST /api/alarm/disarm` no declaraba `config.rateLimit` y el plugin está
 * registrado con `global: false`, así que **no tenía ningún límite**: un PIN de 4
 * dígitos son 10.000 intentos a ~70 ms de `bcrypt.compare` — minutos con
 * concurrencia, y encima saturando el threadpool de libuv. El rate-limit por IP
 * frena el ritmo; este lockout por **sujeto** (el usuario autenticado) frena el
 * total, con el mismo backoff exponencial que el login (US-77).
 *
 * Parámetros más agresivos que los del login a propósito: equivocarse con el PIN de
 * casa es raro y el coste de esperar es bajo, mientras que el premio de acertar es
 * desactivar la alarma.
 */
import { createAttemptLockout } from '../../auth/attempt-lockout.js';

/** Intentos seguidos con PIN incorrecto antes del primer bloqueo. */
export const ALARM_PIN_FAILURE_THRESHOLD = 5;
/** Primer bloqueo (se dobla en cada fallo posterior). */
export const ALARM_PIN_BASE_LOCKOUT_MS = 30_000;
/** Tope del bloqueo: 15 min. La alarma sigue armada mientras tanto. */
export const ALARM_PIN_MAX_LOCKOUT_MS = 900_000;
/** Inactividad tras la cual se olvida el contador. */
export const ALARM_PIN_RESET_AFTER_MS = 3_600_000;

export const alarmPinLockout = createAttemptLockout({
  failureThreshold: ALARM_PIN_FAILURE_THRESHOLD,
  baseLockoutMs: ALARM_PIN_BASE_LOCKOUT_MS,
  maxLockoutMs: ALARM_PIN_MAX_LOCKOUT_MS,
  resetAfterMs: ALARM_PIN_RESET_AFTER_MS,
});
