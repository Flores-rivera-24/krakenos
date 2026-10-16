import type {
  CreateFirewallRuleRequest,
  FirewallManager,
  UpdateFirewallRuleRequest,
} from '@krakenos/types';
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
} from './firewall.schemas.js';

interface FirewallRoutesOpts {
  firewall: FirewallManager; /** Dónde buscar el helper (la capacidad de este equipo depende de ello). */
  gateway: GatewayProbe;
}

export const firewallRoutes: FastifyPluginAsync<FirewallRoutesOpts> = async (app, opts) => {
  const { firewall } = opts;
  const capability = gatewayCapabilityOf(firewall, opts.gateway);
  // El firewall es configuración privilegiada: toda la gestión es solo admin.
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
    return firewall.listRules();
  });

  app.post<{ Body: CreateFirewallRuleRequest }>(
    '/rules',
    { schema: createRuleSchema },
    async (req, reply) => {
      const rule = await firewall.createRule(req.body);
      app.audit({
        action: 'firewall.rule.add',
        userId: req.user.sub,
        detail: rule.name,
        ip: req.ip,
      });
      return reply.code(201).send(rule);
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateFirewallRuleRequest }>(
    '/rules/:id',
    { schema: updateRuleSchema },
    async (req, reply) => {
      const rule = await firewall.updateRule(req.params.id, req.body);
      if (!rule) {
        return reply.code(404).send({ code: 'RULE_NOT_FOUND', message: 'Regla no encontrada' });
      }
      app.audit({
        action: 'firewall.rule.update',
        userId: req.user.sub,
        detail: rule.name,
        ip: req.ip,
      });
      return rule;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/rules/:id',
    { schema: removeRuleSchema },
    async (req, reply) => {
      const removed = await firewall.removeRule(req.params.id);
      if (!removed) {
        return reply.code(404).send({ code: 'RULE_NOT_FOUND', message: 'Regla no encontrada' });
      }
      app.audit({
        action: 'firewall.rule.remove',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.code(204).send();
    },
  );
};
