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
 * Decora `app.audit` para registrar acciones relevantes. Escribe de forma
 * best-effort: un fallo de auditoría nunca debe tumbar la petición.
 */
export const auditPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('audit', (input: AuditInput) => {
    // `detail` puede venir de entrada del usuario (email, etc.): se trunca para
    // que un valor enorme no infle el log ni la base de datos (US-58).
    const detail = input.detail != null ? input.detail.slice(0, MAX_DETAIL_LEN) : null;
    void app.prisma.auditLog
      .create({
        data: {
          action: input.action,
          userId: input.userId ?? null,
          detail,
          ip: input.ip ?? null,
        },
      })
      .then(() => {
        // Tras registrar la acción, notifica los eventos de alta prioridad (US-45).
        // Fire-and-forget: no bloquea ni afecta a la respuesta HTTP.
        app.push?.notifyForAudit(input.action, input.detail, input.ip);
      })
      .catch((err: unknown) => app.log.warn({ err }, 'No se pudo registrar auditoría'));
  });
});
