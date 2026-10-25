import { renameSync } from 'node:fs';
import { rename } from 'node:fs/promises';

/**
 * `rename` que reintenta ante un bloqueo pasajero (US-280).
 *
 * En Windows, un antivirus o el indexador tienen el fichero abierto un instante tras
 * crearlo y el `rename` falla con `EPERM`/`EBUSY`/`EACCES` aunque nadie lo esté usando de
 * verdad. En Linux no pasa, y por eso el código escribía `rename` a pelo. Se reintenta un
 * número CORTO de veces con backoff exponencial (20 → 40 → 80 → 160 ms: ~0,3 s en total);
 * pasado el tope, el error original se propaga tal cual — un permiso mal puesto de verdad
 * no se esconde. Cualquier otro código (`ENOENT`, `EXDEV`…) NO se reintenta: reintentar lo
 * que no es pasajero solo retrasa el error.
 */

/** Códigos que significan «ocupado ahora», no «no se puede nunca». */
const CODIGOS_REINTENTABLES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES']);

const INTENTOS_POR_DEFECTO = 5;
const ESPERA_INICIAL_MS = 20;

export function esBloqueoPasajero(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && CODIGOS_REINTENTABLES.has(code);
}

export interface RenameRetryOptions {
  /** Intentos totales (el primero incluido). */
  attempts?: number;
  /** Espera tras el primer fallo; se duplica en cada reintento. */
  baseDelayMs?: number;
}

export interface AsyncRenameRetryOptions extends RenameRetryOptions {
  /** Inyectable en tests. */
  rename?: (from: string, to: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncRenameRetryOptions extends RenameRetryOptions {
  rename?: (from: string, to: string) => void;
  sleep?: (ms: number) => void;
}

const dormir = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Espera síncrona sin gastar CPU (el arranque no tiene event loop útil que ceder). */
function dormirSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export async function renameWithRetry(
  from: string,
  to: string,
  opts: AsyncRenameRetryOptions = {},
): Promise<void> {
  const attempts = Math.max(1, opts.attempts ?? INTENTOS_POR_DEFECTO);
  const doRename = opts.rename ?? rename;
  const sleep = opts.sleep ?? dormir;
  let espera = opts.baseDelayMs ?? ESPERA_INICIAL_MS;
  for (let intento = 1; ; intento++) {
    try {
      await doRename(from, to);
      return;
    } catch (err) {
      if (!esBloqueoPasajero(err) || intento >= attempts) throw err;
      await sleep(espera);
      espera *= 2;
    }
  }
}

/** Variante síncrona, para el arranque y para `secure-fs` (todo su flujo es síncrono). */
export function renameSyncWithRetry(
  from: string,
  to: string,
  opts: SyncRenameRetryOptions = {},
): void {
  const attempts = Math.max(1, opts.attempts ?? INTENTOS_POR_DEFECTO);
  const doRename = opts.rename ?? renameSync;
  const sleep = opts.sleep ?? dormirSync;
  let espera = opts.baseDelayMs ?? ESPERA_INICIAL_MS;
  for (let intento = 1; ; intento++) {
    try {
      doRename(from, to);
      return;
    } catch (err) {
      if (!esBloqueoPasajero(err) || intento >= attempts) throw err;
      sleep(espera);
      espera *= 2;
    }
  }
}
