/**
 * Lockout genérico por sujeto con backoff exponencial.
 *
 * Lo estrenó el login por cuenta (US-77) y US-227 lo reutiliza para el PIN de la
 * alarma (AUD3-03): un secreto corto detrás de una ruta sin límite es fuerza bruta
 * garantizada. En vez de duplicar el algoritmo, se extrae aquí como fábrica y cada
 * uso instancia el suyo con sus parámetros y su propio mapa (los contadores del
 * login y los del PIN **no** se mezclan).
 *
 * Singleton en memoria por instancia (igual que `rate-limit-store`/`mfa-token-store`):
 * el agente es un único proceso doméstico. La memoria queda acotada porque las
 * entradas inactivas caducan (`resetAfterMs`) al consultarlas o al registrar fallos.
 */

export interface AttemptLockoutOptions {
  /** Fallos consecutivos permitidos antes del primer bloqueo. */
  failureThreshold: number;
  /** Duración del primer bloqueo (se dobla en cada fallo posterior). */
  baseLockoutMs: number;
  /** Tope de la duración del bloqueo. */
  maxLockoutMs: number;
  /** Inactividad tras la cual se olvida el contador de un sujeto. */
  resetAfterMs: number;
}

export interface AttemptLockout {
  /**
   * Segundos que faltan para que el sujeto pueda volver a intentar, o `0` si no
   * está bloqueado. No muta el estado (salvo purgar una entrada ya inactiva).
   */
  retryAfterSec(subject: string, now?: number): number;
  /**
   * Registra un fallo y devuelve los segundos de bloqueo aplicados tras él
   * (`0` si aún no se alcanza el umbral).
   */
  recordFailure(subject: string, now?: number): number;
  /** Limpia el contador de un sujeto (intento correcto). */
  recordSuccess(subject: string): void;
  /** Vacía el registro (útil en tests). */
  reset(): void;
  /** Duración de bloqueo (ms) para un número de fallos acumulados. */
  lockoutMsForFailures(failures: number): number;
}

interface Attempt {
  failures: number;
  /** Epoch (ms) hasta el que el sujeto está bloqueado; 0 si no lo está. */
  lockedUntil: number;
  lastFailureAt: number;
}

/** Crea un lockout independiente con su propio mapa de intentos. */
export function createAttemptLockout(opts: AttemptLockoutOptions): AttemptLockout {
  const attempts = new Map<string, Attempt>();
  const keyFor = (subject: string) => subject.trim().toLowerCase();

  const lockoutMsForFailures = (failures: number): number => {
    if (failures < opts.failureThreshold) return 0;
    const ms = opts.baseLockoutMs * 2 ** (failures - opts.failureThreshold);
    return Math.min(opts.maxLockoutMs, ms);
  };

  return {
    lockoutMsForFailures,

    retryAfterSec(subject: string, now: number = Date.now()): number {
      const key = keyFor(subject);
      const a = attempts.get(key);
      if (!a) return 0;
      if (now - a.lastFailureAt > opts.resetAfterMs) {
        attempts.delete(key);
        return 0;
      }
      return a.lockedUntil > now ? Math.ceil((a.lockedUntil - now) / 1000) : 0;
    },

    recordFailure(subject: string, now: number = Date.now()): number {
      const key = keyFor(subject);
      const prev = attempts.get(key);
      const failures =
        prev && now - prev.lastFailureAt <= opts.resetAfterMs ? prev.failures + 1 : 1;
      const ms = lockoutMsForFailures(failures);
      attempts.set(key, { failures, lastFailureAt: now, lockedUntil: ms > 0 ? now + ms : 0 });
      return Math.ceil(ms / 1000);
    },

    recordSuccess(subject: string): void {
      attempts.delete(keyFor(subject));
    },

    reset(): void {
      attempts.clear();
    },
  };
}
