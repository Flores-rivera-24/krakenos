/**
 * Lock de «actualización en curso» (US-232 / AUD3-20).
 *
 * Hasta ahora el lock era un fichero de texto y `inProgress` se resolvía con un
 * `existsSync` pelado. Como el actualizador **moría en su propio `systemctl
 * restart`** (no salía del cgroup de la unidad), el lock quedaba huérfano y la UI
 * decía «ya hay una actualización en curso» **para siempre**, sin forma de
 * liberarlo salvo borrando el fichero por SSH.
 *
 * Ahora el lock lleva PID y marca de tiempo, y se considera **caduco** si su
 * proceso ya no existe o si lleva más de `LOCK_TTL_MS` (una actualización real
 * —install + build en una Raspberry— no pasa de ~20 min). Un lock caduco no
 * bloquea: `apply()` lo pisa. Y para el caso contrario —un actualizador vivo pero
 * atascado— hay cancelación explícita desde la UI.
 *
 * Módulo **puro**: no toca el disco ni consulta procesos; recibe el contenido y
 * los predicados. Así se prueba sin lanzar nada.
 */

/** Edad máxima de un lock antes de considerarlo caduco (20 min). */
export const LOCK_TTL_MS = 20 * 60 * 1000;

export interface UpdateLock {
  /** Versión objetivo de la actualización en curso. */
  version: string;
  /** PID del proceso actualizador. */
  pid: number;
  /** Instante de arranque (ISO). */
  startedAt: string;
}

export function serializeLock(lock: UpdateLock): string {
  return `${JSON.stringify(lock)}\n`;
}

/**
 * Parseo **defensivo** (patrón US-63). Devuelve `null` si el contenido no es un
 * lock reconocible — incluye el formato de texto plano anterior a US-232, que se
 * trata como lock sin PID: caduca solo por edad.
 */
export function parseLock(raw: string): UpdateLock | null {
  try {
    const parsed = JSON.parse(raw) as Partial<UpdateLock>;
    if (
      parsed &&
      typeof parsed.version === 'string' &&
      typeof parsed.pid === 'number' &&
      typeof parsed.startedAt === 'string' &&
      !Number.isNaN(Date.parse(parsed.startedAt))
    ) {
      return { version: parsed.version, pid: parsed.pid, startedAt: parsed.startedAt };
    }
    return null;
  } catch {
    // Formato legado (`<version>\n<iso>\n`): sin PID, pero la fecha sirve para el TTL.
    const [version, startedAt] = raw.split('\n');
    if (version && startedAt && !Number.isNaN(Date.parse(startedAt))) {
      return { version: version.trim(), pid: 0, startedAt: startedAt.trim() };
    }
    return null;
  }
}

export interface StaleCheck {
  /** ¿Sigue vivo ese PID? `pid: 0` (lock legado) se considera desconocido → solo TTL. */
  isProcessAlive: (pid: number) => boolean;
  now: () => number;
  ttlMs?: number;
}

/**
 * ¿El lock ya no representa una actualización viva? Un lock ilegible es caduco
 * (mejor pisarlo que bloquear la función para siempre).
 */
export function isLockStale(lock: UpdateLock | null, check: StaleCheck): boolean {
  if (!lock) return true;
  const age = check.now() - Date.parse(lock.startedAt);
  if (age >= (check.ttlMs ?? LOCK_TTL_MS)) return true;
  // Sin PID conocido (lock legado) no se puede comprobar el proceso: manda el TTL.
  if (lock.pid <= 0) return false;
  return !check.isProcessAlive(lock.pid);
}

/** ¿Existe ese proceso? `kill(pid, 0)` no envía señal: solo comprueba. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = existe pero es de otro usuario → sigue vivo.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
