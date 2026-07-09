import type { CreateAutomationRuleRequest, UpdateAutomationRuleRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { AutomationService } from './automations.service.js';
import {
  createAutomationSchema,
  deleteAutomationSchema,
  listAutomationRunsSchema,
  listAutomationsSchema,
  updateAutomationSchema,
} from './automations.schemas.js';

interface AutomationsRoutesOpts {
  service: AutomationService;
}

/**
 * Automatizaciones «si X entonces Y» (US-167). Lectura = autenticado (reglas y
 * log de ejecuciones); crear/editar/borrar = admin y auditado. La ejecución no
 * tiene endpoint: dispara el motor (bus de eventos + barrido horario).
 */
export const automationsRoutes: FastifyPluginAsync<AutomationsRoutesOpts> = async (app, opts) => {
  const { service } = opts;
  const adminOnly = app.requireRole('admin');

  app.get('/', { schema: listAutomationsSchema, preHandler: app.authenticate }, async () =>
    service.list(),
  );

  // Log de ejecuciones (las últimas 50, opcionalmente por regla).
  app.get<{ Querystring: { ruleId?: string } }>(
    '/runs',
    { schema: listAutomationRunsSchema, preHandler: app.authenticate },
    async (req) => service.listRuns(req.query.ruleId),
  );

  app.post<{ Body: CreateAutomationRuleRequest }>(
    '/',
    { schema: createAutomationSchema, preHandler: adminOnly },
    async (req, reply) => {
      const rule = await service.create(req.body);
      app.audit({
        action: 'automation.create',
        userId: req.user.sub,
        detail: `${rule.id} · ${rule.name}`,
        ip: req.ip,
      });
      return reply.code(201).send(rule);
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateAutomationRuleRequest }>(
    '/:id',
    { schema: updateAutomationSchema, preHandler: adminOnly },
    async (req, reply) => {
      const rule = await service.update(req.params.id, req.body);
      if (!rule) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Automatización no encontrada' });
      }
      app.audit({
        action: 'automation.update',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.send(rule);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: deleteAutomationSchema, preHandler: adminOnly },
    async (req, reply) => {
      const ok = await service.remove(req.params.id);
      if (!ok) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Automatización no encontrada' });
      }
      app.audit({
        action: 'automation.delete',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.code(204).send();
    },
  );
};
