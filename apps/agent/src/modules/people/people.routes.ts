import type { PausePersonRequest, SetBedtimeRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { PeopleService } from './people.service.js';
import {
  clearBedtimeSchema,
  listPeopleSchema,
  pausePersonSchema,
  resumePersonSchema,
  setBedtimeSchema,
} from './people.schemas.js';

interface PeopleRoutesOpts {
  service: PeopleService;
}

/**
 * Personas del hogar (US-240) — el control parental por persona.
 *
 * **Lectura**: autenticada, con privacidad por rol aplicada en el servicio (admin
 * ve el hogar; el resto, solo lo suyo). **Escritura**: admin y auditada, igual que
 * `/api/access`, porque cortar internet es una decisión sobre la red del hogar y
 * no «operar lo cotidiano» — un `member` no debe poder dejar sin internet a otro.
 */
export const peopleRoutes: FastifyPluginAsync<PeopleRoutesOpts> = async (app, opts) => {
  const { service } = opts;
  const adminOnly = app.requireRole('admin');

  app.get('/', { schema: listPeopleSchema, preHandler: app.authenticate }, async (req) =>
    service.list({ sub: req.user.sub, role: req.user.role }),
  );

  /** ¿Existe la persona? Evita que una acción sobre un id inventado responda «0 aplicados». */
  const findPerson = async (id: string): Promise<boolean> =>
    (await app.prisma.user.findUnique({ where: { id }, select: { id: true } })) !== null;

  app.post<{ Params: { id: string }; Body: PausePersonRequest }>(
    '/:id/pause',
    { schema: pausePersonSchema, preHandler: adminOnly },
    async (req, reply) => {
      if (!(await findPerson(req.params.id))) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Persona no encontrada' });
      }
      const result = await service.pause(req.params.id, req.body.minutes);
      app.audit({
        action: 'people.pause',
        userId: req.user.sub,
        detail: `${req.params.id} · ${req.body.minutes}m · ${result.applied}/${result.applied + result.failed}`,
        ip: req.ip,
      });
      return reply.send(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/resume',
    { schema: resumePersonSchema, preHandler: adminOnly },
    async (req, reply) => {
      if (!(await findPerson(req.params.id))) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Persona no encontrada' });
      }
      const result = await service.resume(req.params.id);
      app.audit({
        action: 'people.resume',
        userId: req.user.sub,
        detail: `${req.params.id} · ${result.applied}/${result.applied + result.failed}`,
        ip: req.ip,
      });
      return reply.send(result);
    },
  );

  app.put<{ Params: { id: string }; Body: SetBedtimeRequest }>(
    '/:id/bedtime',
    { schema: setBedtimeSchema, preHandler: adminOnly },
    async (req, reply) => {
      if (!(await findPerson(req.params.id))) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Persona no encontrada' });
      }
      const result = await service.setBedtime(req.params.id, req.body);
      app.audit({
        action: 'people.bedtime.set',
        userId: req.user.sub,
        detail: `${req.params.id} · ${req.body.startMinute}-${req.body.endMinute} · ${result.applied} dispositivo(s)`,
        ip: req.ip,
      });
      return reply.send(result);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id/bedtime',
    { schema: clearBedtimeSchema, preHandler: adminOnly },
    async (req, reply) => {
      if (!(await findPerson(req.params.id))) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Persona no encontrada' });
      }
      const result = await service.clearBedtime(req.params.id);
      app.audit({
        action: 'people.bedtime.clear',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.send(result);
    },
  );
};
