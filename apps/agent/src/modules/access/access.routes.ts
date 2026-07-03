import type { CreateAccessScheduleRequest, UpdateAccessScheduleRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { AccessScheduleService } from './access.service.js';
import {
  createScheduleSchema,
  deleteScheduleSchema,
  listSchedulesSchema,
  updateScheduleSchema,
} from './access.schemas.js';

interface AccessRoutesOpts {
  service: AccessScheduleService;
}

/**
 * Horarios de acceso / control parental (US-108). Lectura = autenticado,
 * escritura = admin (y auditada). La aplicación real la hace el barrido del
 * `AccessScheduleService`.
 */
export const accessRoutes: FastifyPluginAsync<AccessRoutesOpts> = async (app, opts) => {
  const { service } = opts;
  const adminOnly = app.requireRole('admin');

  app.get<{ Querystring: { mac?: string } }>(
    '/schedules',
    { schema: listSchedulesSchema, preHandler: app.authenticate },
    async (req) => (req.query.mac ? service.listForMac(req.query.mac) : service.list()),
  );

  app.post<{ Body: CreateAccessScheduleRequest }>(
    '/schedules',
    { schema: createScheduleSchema, preHandler: adminOnly },
    async (req, reply) => {
      const schedule = await service.create(req.body);
      app.audit({
        action: 'access.schedule.create',
        userId: req.user.sub,
        detail: `${schedule.id} · ${schedule.mac}`,
        ip: req.ip,
      });
      return reply.code(201).send(schedule);
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateAccessScheduleRequest }>(
    '/schedules/:id',
    { schema: updateScheduleSchema, preHandler: adminOnly },
    async (req, reply) => {
      const schedule = await service.update(req.params.id, req.body);
      if (!schedule) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Horario no encontrado' });
      }
      app.audit({
        action: 'access.schedule.update',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.send(schedule);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/schedules/:id',
    { schema: deleteScheduleSchema, preHandler: adminOnly },
    async (req, reply) => {
      const ok = await service.remove(req.params.id);
      if (!ok) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Horario no encontrado' });
      }
      app.audit({
        action: 'access.schedule.delete',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.code(204).send();
    },
  );
};
