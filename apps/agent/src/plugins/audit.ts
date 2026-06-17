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

/**
 * Decora `app.audit` para registrar acciones relevantes. Escribe de forma
 * best-effort: un fallo de auditoría nunca debe tumbar la petición.
 */
export const auditPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('audit', (input: AuditInput) => {
    void app.prisma.auditLog
      .create({
        data: {
          action: input.action,
          userId: input.userId ?? null,
          detail: input.detail ?? null,
          ip: input.ip ?? null,
        },
      })
      .catch((err: unknown) => app.log.warn({ err }, 'No se pudo registrar auditoría'));
  });
});
