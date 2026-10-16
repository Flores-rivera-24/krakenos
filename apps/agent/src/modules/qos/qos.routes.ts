import type { CreateQosRuleRequest, QosManager, UpdateQosRuleRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import {
  gatewayCapabilityOf,
  requireGatewaySupported,
  type GatewayProbe,
} from '../../privileged/gateway-capability.js';
import { gatewayStatusSchema } from '../common.schemas.js';
import {
  createRuleSchema,
  listRulesSchema,
  removeRuleSchema,
  updateRuleSchema,
} from './qos.schemas.js';

interface QosRoutesOpts {
  qos: QosManager; /** Dónde buscar el helper (la capacidad de este equipo depende de ello). */
  gateway: GatewayProbe;
}

export const qosRoutes: FastifyPluginAsync<QosRoutesOpts> = async (app, opts) => {
  const { qos } = opts;
  const capability = gatewayCapabilityOf(qos, opts.gateway);
  // El QoS es configuración privilegiada: toda la gestión es solo admin.
  app.addHook('preHandler', app.requireRole('admin'));

  // Escribir exige que este equipo pueda aplicar el cambio; las lecturas siguen (la UI
  // necesita el estado para enseñar por qué no se puede).
  app.addHook('preHandler', requireGatewaySupported(capability));

  // La lista es un array y no admite campos: la capacidad viaja en su propio estado, igual que
  // en `/vpn/status`.
  app.get('/status', { schema: gatewayStatusSchema }, async () => ({
    capability: capability(),
  }));

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
      app.audit({
        action: 'qos.rule.remove',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.code(204).send();
    },
  );
};
