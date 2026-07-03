import type { UpdateAlertRuleRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { AlertConfigService } from '../../alerts/alert-config.js';
import { listAlertRulesSchema, updateAlertRuleSchema } from './alerts.schemas.js';

interface AlertsRoutesOpts {
  service: AlertConfigService;
}

/**
 * Reglas de alerta (US-112). Lectura autenticada; escritura admin (auditada). El
 * catálogo de eventos es fijo; solo se togglean push/email por evento.
 */
export const alertsRoutes: FastifyPluginAsync<AlertsRoutesOpts> = async (app, opts) => {
  const { service } = opts;

  app.get('/rules', { schema: listAlertRulesSchema, preHandler: app.authenticate }, async () =>
    service.list(),
  );

  app.patch<{ Params: { event: string }; Body: UpdateAlertRuleRequest }>(
    '/rules/:event',
    { schema: updateAlertRuleSchema, preHandler: app.requireRole('admin') },
    async (req, reply) => {
      const rule = await service.update(req.params.event, req.body);
      if (!rule) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Evento de alerta desconocido' });
      }
      app.audit({
        action: 'alerts.rule.update',
        userId: req.user.sub,
        detail: `${rule.event} push=${rule.push} email=${rule.email}`,
        ip: req.ip,
      });
      return reply.send(rule);
    },
  );
};
