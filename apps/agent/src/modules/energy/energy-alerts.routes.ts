import type { CreateEnergyAlertRuleRequest, UpdateEnergyAlertRuleRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { EnergyAlertService } from './energy-alerts.service.js';
import {
  createEnergyAlertSchema,
  deleteEnergyAlertSchema,
  listEnergyAlertsSchema,
  updateEnergyAlertSchema,
} from './energy-alerts.schemas.js';

interface EnergyAlertsRoutesOpts {
  service: EnergyAlertService;
}

/**
 * Reglas de alerta de consumo (US-183). Lectura autenticada; alta/edición/baja
 * solo admin y auditadas (como el resto de escrituras del panel de energía).
 */
export const energyAlertsRoutes: FastifyPluginAsync<EnergyAlertsRoutesOpts> = async (app, opts) => {
  const { service } = opts;

  app.get('/', { schema: listEnergyAlertsSchema, preHandler: app.authenticate }, async () =>
    service.list(),
  );

  app.post<{ Body: CreateEnergyAlertRuleRequest }>(
    '/',
    { schema: createEnergyAlertSchema, preHandler: app.requireRole('admin') },
    async (req, reply) => {
      const created = await service.create(req.body);
      app.audit({ action: 'energy.alert.create', userId: req.user.sub, detail: created.deviceId, ip: req.ip });
      return reply.code(201).send(created);
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateEnergyAlertRuleRequest }>(
    '/:id',
    { schema: updateEnergyAlertSchema, preHandler: app.requireRole('admin') },
    async (req, reply) => {
      const updated = await service.update(req.params.id, req.body);
      if (!updated) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Regla no encontrada' });
      app.audit({ action: 'energy.alert.update', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: deleteEnergyAlertSchema, preHandler: app.requireRole('admin') },
    async (req, reply) => {
      const ok = await service.remove(req.params.id);
      if (!ok) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Regla no encontrada' });
      app.audit({ action: 'energy.alert.delete', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
