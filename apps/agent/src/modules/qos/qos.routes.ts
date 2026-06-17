import type { CreateQosRuleRequest, QosManager, UpdateQosRuleRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import {
  createRuleSchema,
  listRulesSchema,
  removeRuleSchema,
  updateRuleSchema,
} from './qos.schemas.js';

interface QosRoutesOpts {
  qos: QosManager;
}

export const qosRoutes: FastifyPluginAsync<QosRoutesOpts> = async (app, opts) => {
  const { qos } = opts;
  // El QoS es configuración privilegiada: toda la gestión es solo admin.
  app.addHook('preHandler', app.requireRole('admin'));

  app.get('/rules', { schema: listRulesSchema }, async () => {
    return qos.listRules();
  });

  app.post<{ Body: CreateQosRuleRequest }>(
    '/rules',
    { schema: createRuleSchema },
    async (req, reply) => {
      const rule = await qos.createRule(req.body);
      app.audit({ action: 'qos.rule.add', userId: req.user.sub, detail: rule.name, ip: req.ip });
      return reply.code(201).send(rule);
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateQosRuleRequest }>(
    '/rules/:id',
    { schema: updateRuleSchema },
    async (req, reply) => {
      const rule = await qos.updateRule(req.params.id, req.body);
      if (!rule) {
        return reply.code(404).send({ code: 'RULE_NOT_FOUND', message: 'Regla no encontrada' });
      }
      app.audit({ action: 'qos.rule.update', userId: req.user.sub, detail: rule.name, ip: req.ip });
      return rule;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/rules/:id',
    { schema: removeRuleSchema },
    async (req, reply) => {
      const removed = await qos.removeRule(req.params.id);
      if (!removed) {
        return reply.code(404).send({ code: 'RULE_NOT_FOUND', message: 'Regla no encontrada' });
      }
      app.audit({ action: 'qos.rule.remove', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
