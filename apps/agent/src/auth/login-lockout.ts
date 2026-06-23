/**
 * Lockout por **cuenta** (email) con backoff exponencial para el login (US-77, F3).
 *
 * El rate limit de `/auth/login` es por **IP** (`plugins/rate-limit-store.ts`), así
 * que una fuerza bruta distribuida (varias IP de la VPN) o un password-spray sobre
 * muchas cuentas no se frena por usuario. Este store añade un contador **por email**:
 * tras N fallos consecutivos bloquea temporalmente esa cuenta, doblando la espera en
 * cada fallo posterior (con tope), y se limpia al primer login correcto.
 *
 * Singleton en memoria (igual que `rate-limit-store`/`mfa-token-store`): el agente
 * es un único proceso doméstico, no hace falta almacenamiento compartido. La memoria
 * queda acotada porque las entradas inactivas caducan (`RESET_AFTER_MS`).
 *
 * Anti-enumeración: el llamante registra el fallo y comprueba el bloqueo para
 * **cualquier** email (exista o no), de modo que un atacante no distingue cuentas
 * reales por el comportamiento del lockout. Contrapartida conocida (DoS dirigido):
 * provocar fallos puede bloquear temporalmente la cuenta de un tercero; mitigado por
 * ser **temporal** (tope `MAX_LOCKOUT_MS`), por cuenta (no global) y por el límite por IP.
 */

/** Fallos consecutivos permitidos antes del primer bloqueo. */
export const FAILURE_THRESHOLD = 5;
/** Duración del primer bloqueo (se dobla en cada fallo posterior). */
export const BASE_LOCKOUT_MS = 30_000;
/** Tope de la duración del bloqueo. */
export const MAX_LOCKOUT_MS = 3_600_000;
/** Inactividad tras la cual se olvida el contador de una cuenta. */
export const RESET_AFTER_MS = 3_600_000;

interface Attempt {
  failures: number;
  /** Epoch (ms) hasta el que la cuenta está bloqueada; 0 si no lo está. */
  lockedUntil: number;
  lastFailureAt: number;
}

const attempts = new Map<string, Attempt>();

function keyFor(email: string): string {
  return email.trim().toLowerCase();
}

/** Duración de bloqueo (ms) para un número de fallos acumulados. */
export function lockoutMsForFailures(failures: number): number {
  if (failures < FAILURE_THRESHOLD) return 0;
  const ms = BASE_LOCKOUT_MS * 2 ** (failures - FAILURE_THRESHOLD);
  return Math.min(MAX_LOCKOUT_MS, ms);
}

export const loginLockout = {
  /**
   * Segundos que faltan para que la cuenta pueda volver a intentar, o `0` si no
   * está bloqueada. No muta el estado (salvo purgar una entrada ya inactiva).
   */
  retryAfterSec(email: string, now: number = Date.now()): number {
    const key = keyFor(email);
    const a = attempts.get(key);
    if (!a) return 0;
    if (now - a.lastFailureAt > RESET_AFTER_MS) {
      attempts.delete(key);
      return 0;
    }
    return a.lockedUntil > now ? Math.ceil((a.lockedUntil - now) / 1000) : 0;
  },

  /**
   * Registra un fallo de login para la cuenta y devuelve los segundos de bloqueo
   * aplicados tras este fallo (`0` si aún no se alcanza el umbral).
   */
  recordFailure(email: string, now: number = Date.now()): number {
    const key = keyFor(email);
    const prev = attempts.get(key);
    const failures =
      prev && now - prev.lastFailureAt <= RESET_AFTER_MS ? prev.failures + 1 : 1;
    const ms = lockoutMsForFailures(failures);
    attempts.set(key, {
      failures,
      lastFailureAt: now,
      lockedUntil: ms > 0 ? now + ms : 0,
    });
    return Math.ceil(ms / 1000);
  },

  /** Limpia el contador de una cuenta (login correcto). */
  recordSuccess(email: string): void {
    attempts.delete(keyFor(email));
  },

  /** Vacía el registro (útil en tests). */
  reset(): void {
    attempts.clear();
  },
};
