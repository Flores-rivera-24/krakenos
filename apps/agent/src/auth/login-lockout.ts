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

import { createAttemptLockout } from './attempt-lockout.js';

/** Fallos consecutivos permitidos antes del primer bloqueo. */
export const FAILURE_THRESHOLD = 5;
/** Duración del primer bloqueo (se dobla en cada fallo posterior). */
export const BASE_LOCKOUT_MS = 30_000;
/** Tope de la duración del bloqueo. */
export const MAX_LOCKOUT_MS = 3_600_000;
/** Inactividad tras la cual se olvida el contador de una cuenta. */
export const RESET_AFTER_MS = 3_600_000;

/**
 * Instancia del lockout genérico para el login por cuenta. El algoritmo vive en
 * `attempt-lockout.ts` desde US-227 (lo comparte el PIN de la alarma), con un mapa
 * propio por instancia: los contadores de login y de alarma no se mezclan.
 */
export const loginLockout = createAttemptLockout({
  failureThreshold: FAILURE_THRESHOLD,
  baseLockoutMs: BASE_LOCKOUT_MS,
  maxLockoutMs: MAX_LOCKOUT_MS,
  resetAfterMs: RESET_AFTER_MS,
});

/** Duración de bloqueo (ms) para un número de fallos acumulados. */
export const lockoutMsForFailures = loginLockout.lockoutMsForFailures;
