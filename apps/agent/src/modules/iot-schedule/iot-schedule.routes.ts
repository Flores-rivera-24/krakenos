import type { CreateIotScheduleRequest, UpdateIotScheduleRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { IotScheduleService } from './iot-schedule.service.js';
import {
  createIotScheduleSchema,
  deleteIotScheduleSchema,
  listIotSchedulesSchema,
  updateIotScheduleSchema,
} from './iot-schedule.schemas.js';

interface IotScheduleRoutesOpts {
  service: IotScheduleService;
}

/**
 * Horarios para IoT/escenas (US-168). Lectura = autenticado; escritura = admin y
 * auditada. La aplicación real la hace el barrido del `IotScheduleService`.
 */
export const iotScheduleRoutes: FastifyPluginAsync<IotScheduleRoutesOpts> = async (app, opts) => {
  const { service } = opts;
  const adminOnly = app.requireRole('admin');

  app.get('/', { schema: listIotSchedulesSchema, preHandler: app.authenticate }, async () => service.list());

  app.post<{ Body: CreateIotScheduleRequest }>(
    '/',
    { schema: createIotScheduleSchema, preHandler: adminOnly },
    async (req, reply) => {
      const schedule = await service.create(req.body);
      app.audit({ action: 'iot_schedule.create', userId: req.user.sub, detail: `${schedule.id} · ${schedule.name}`, ip: req.ip });
      return reply.code(201).send(schedule);
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateIotScheduleRequest }>(
    '/:id',
    { schema: updateIotScheduleSchema, preHandler: adminOnly },
    async (req, reply) => {
      const schedule = await service.update(req.params.id, req.body);
      if (!schedule) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Horario no encontrado' });
      app.audit({ action: 'iot_schedule.update', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.send(schedule);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: deleteIotScheduleSchema, preHandler: adminOnly },
    async (req, reply) => {
      const ok = await service.remove(req.params.id);
      if (!ok) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Horario no encontrado' });
      app.audit({ action: 'iot_schedule.delete', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
