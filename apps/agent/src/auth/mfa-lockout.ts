/**
 * Lockout por **cuenta** para el segundo factor (`backup-codes/verify` y
 * `authenticate/verify`). Sujeto = id del usuario (el `sub` del `mfaToken`).
 *
 * Sin él, el segundo factor solo tenía el límite por IP: quien conoce la contraseña
 * puede encadenar logins y probar un código tras otro desde varias IP. Mismos
 * parámetros que `loginLockout`, pero **contador propio**: los fallos de contraseña
 * y los del segundo factor no se mezclan.
 */

import { createAttemptLockout } from './attempt-lockout.js';
import {
  BASE_LOCKOUT_MS,
  FAILURE_THRESHOLD,
  MAX_LOCKOUT_MS,
  RESET_AFTER_MS,
} from './login-lockout.js';

export const mfaLockout = createAttemptLockout({
  failureThreshold: FAILURE_THRESHOLD,
  baseLockoutMs: BASE_LOCKOUT_MS,
  maxLockoutMs: MAX_LOCKOUT_MS,
  resetAfterMs: RESET_AFTER_MS,
});
