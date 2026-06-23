import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface AuditInput {
  action: string;
  userId?: string | null;
  detail?: string | null;
  ip?: string | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Registra una acción en el log de auditoría (no lanza si falla). */
    audit: (input: AuditInput) => void;
  }
}

/** Máximo de caracteres persistidos en `detail` (US-58): acota el tamaño del log. */
const MAX_DETAIL_LEN = 1024;

/**
 * Reintentos (ms) ante un fallo de escritura del audit log (US-85, F11): la
 * auditoría era best-effort y un pico de presión en la DB podía **perder**
 * eventos de seguridad (`login_failed`, `device.block`). Se reintenta con backoff
 * antes de rendirse; sigue siendo fire-and-forget (nunca bloquea la petición).
 */
const RETRY_DELAYS_MS = [100, 500, 2000];

/**
 * Hash de un email para el `detail` del audit (US-85, F11): minimiza la PII en
 * reposo (no se guarda el correo en claro de intentos fallidos) pero mantiene la
 * correlación —el mismo email produce el mismo hash—. Prefijo `email:` + sha256
 * truncado. No es secreto (el email es de baja entropía); solo evita el texto plano.
 */
export function hashEmail(email: string): string {
  return `email:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16)}`;
}

/** Dependencias inyectables del bucle de reintento (puro y testeable). */
export interface AuditPersistDeps {
  /** Escritura de una fila de auditoría. */
  create: () => Promise<unknown>;
  /** Se invoca una vez tras la primera escritura correcta. */
  onSuccess: () => void;
  /** Se invoca si se agotan los reintentos. */
  onGiveUp: (err: unknown) => void;
  /** Programador de reintento (inyectable; por defecto `setTimeout` con `unref`). */
  schedule?: (fn: () => void, ms: number) => void;
}

const defaultSchedule = (fn: () => void, ms: number): void => {
  setTimeout(fn, ms).unref?.();
};

/**
 * Escribe con reintentos por backoff (US-85, F11). Fire-and-forget: nunca lanza.
 * Reintenta ante fallo transitorio y, si los agota, llama a `onGiveUp`. Función
 * pura (sin Fastify/Prisma) para poder testear el reintento con un `create` falso.
 */
export function persistAuditWithRetry(
  deps: AuditPersistDeps,
  delays: readonly number[] = RETRY_DELAYS_MS,
  attempt = 0,
): void {
  void deps
    .create()
    .then(() => deps.onSuccess())
    .catch((err: unknown) => {
      const delay = delays[attempt];
      if (delay !== undefined) {
        (deps.schedule ?? defaultSchedule)(
          () => persistAuditWithRetry(deps, delays, attempt + 1),
          delay,
        );
      } else {
        deps.onGiveUp(err);
      }
    });
}

/**
 * Decora `app.audit` para registrar acciones relevantes. Escribe de forma
 * best-effort (nunca tumba la petición) pero con reintentos ante fallo transitorio.
 */
export const auditPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('audit', (input: AuditInput) => {
    // `detail` puede venir de entrada del usuario (email, etc.): se trunca para
    // que un valor enorme no infle el log ni la base de datos (US-58).
    const detail = input.detail != null ? input.detail.slice(0, MAX_DETAIL_LEN) : null;
    persistAuditWithRetry({
      create: () =>
        app.prisma.auditLog.create({
          data: { action: input.action, userId: input.userId ?? null, detail, ip: input.ip ?? null },
        }),
      // Tras registrar la acción, notifica los eventos de alta prioridad (US-45).
      onSuccess: () => app.push?.notifyForAudit(input.action, detail, input.ip),
      onGiveUp: (err) => app.log.warn({ err }, 'No se pudo registrar auditoría tras reintentos'),
    });
  });
});
