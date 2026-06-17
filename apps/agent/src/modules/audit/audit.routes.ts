import type { AuditLogEntry } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { listAuditSchema } from './audit.schemas.js';

interface AuditRow {
  id: string;
  action: string;
  userId: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: Date;
}

export const auditRoutes: FastifyPluginAsync = async (app) => {
  // El registro de auditoría es sensible: solo admin.
  app.get<{ Querystring: { limit?: number } }>(
    '/',
    { schema: listAuditSchema, preHandler: app.requireRole('admin') },
    async (req) => {
      const rows = (await app.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: req.query.limit ?? 50,
      })) as AuditRow[];

      return rows.map(
        (r): AuditLogEntry => ({
          id: r.id,
          action: r.action,
          userId: r.userId,
          detail: r.detail,
          ip: r.ip,
          createdAt: r.createdAt.toISOString(),
        }),
      );
    },
  );
};
