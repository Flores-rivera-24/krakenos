/**
 * Sonda de readiness **que comprueba que se puede escribir** (US-233 / AUD3-21).
 *
 * Antes `/health/ready` hacía `SELECT 1`: con la tarjeta SD en **solo-lectura** (el
 * final típico de una SD gastada: el kernel remonta el FS `ro`) o con el **disco
 * lleno**, esa consulta sigue respondiendo 200 mientras nada se persiste. Y es la
 * sonda que usan el `HEALTHCHECK` de Docker, el bucle del instalador y el
 * healthcheck del actualizador: los tres daban por sano un sistema que ya no
 * guardaba nada.
 *
 * Ahora escribe un **canario**: un upsert de una fila propia de `Setting`. Es la
 * misma ruta de escritura que usa la aplicación (SQLite → WAL → fsync), así que
 * falla exactamente cuando fallaría guardar cualquier cosa.
 *
 * Dos cosas a propósito:
 *  - **Throttle**: el resultado se cachea unos segundos. La sonda la llaman cada 30 s
 *    (Docker) o en bucle apretado (instalador, actualizador), y no tiene sentido
 *    escribir en cada llamada.
 *  - **El espacio libre NO decide** el resultado. Un disco casi lleno todavía
 *    funciona, y devolver 503 por eso metería al contenedor en un bucle de reinicio.
 *    El espacio se publica como métrica (`system/storage.ts`), que es lo útil.
 */

/** Clave de la fila canario (no es un ajuste de usuario; nunca se muestra). */
export const CANARY_KEY = 'health.canary';

/** Cuánto vale un resultado antes de volver a comprobar. */
export const DEFAULT_THROTTLE_MS = 15_000;

interface CanaryPrisma {
  setting: {
    upsert(args: {
      where: { key: string };
      update: { value: string };
      create: { key: string; value: string };
    }): Promise<unknown>;
  };
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

export interface ReadinessProbeOptions {
  prisma: CanaryPrisma;
  throttleMs?: number;
  now?: () => number;
  /** Aviso cuando la escritura falla (una SD en solo-lectura merece un log). */
  onFail?: (err: unknown) => void;
}

export interface ReadinessProbe {
  /** ¿Está el sistema listo (lee y **escribe**)? Nunca lanza. */
  check(): Promise<boolean>;
}

export function createReadinessProbe(opts: ReadinessProbeOptions): ReadinessProbe {
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  const now = opts.now ?? (() => Date.now());
  let cached: { at: number; ok: boolean } | null = null;
  let inFlight: Promise<boolean> | null = null;

  const probe = async (): Promise<boolean> => {
    try {
      await opts.prisma.$queryRaw`SELECT 1`;
      // El canario: si el FS está en solo-lectura o el disco lleno, esto lanza.
      const value = new Date(now()).toISOString();
      await opts.prisma.setting.upsert({
        where: { key: CANARY_KEY },
        update: { value },
        create: { key: CANARY_KEY, value },
      });
      return true;
    } catch (err) {
      opts.onFail?.(err);
      return false;
    }
  };

  return {
    async check(): Promise<boolean> {
      const at = now();
      if (cached && at - cached.at < throttleMs) return cached.ok;
      // Single-flight: un orquestador impaciente no debe lanzar N escrituras.
      if (inFlight) return inFlight;
      inFlight = probe()
        .then((ok) => {
          cached = { at: now(), ok };
          return ok;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}
