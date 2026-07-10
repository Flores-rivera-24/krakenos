import type { EnergyRange } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { EnergyConfigError, type EnergyService } from './energy.service.js';
import {
  energyStatsSchema,
  getEnergyConfigSchema,
  updateEnergyConfigSchema,
} from './energy.schemas.js';

interface EnergyRoutesOpts {
  service: EnergyService;
}

/**
 * Panel de energía (US-182): estadísticas de consumo (lectura autenticada) y
 * configuración del precio del kWh / moneda (solo admin, auditada). El coste se
 * estima en el servicio a partir del precio configurado.
 */
export const energyRoutes: FastifyPluginAsync<EnergyRoutesOpts> = async (app, opts) => {
  const { service } = opts;

  app.get<{ Querystring: { range?: EnergyRange } }>(
    '/stats',
    { schema: energyStatsSchema, preHandler: app.authenticate },
    async (req) => service.getStats(req.query.range ?? 'day'),
  );

  app.get('/config', { schema: getEnergyConfigSchema, preHandler: app.authenticate }, async () =>
    service.getConfig(),
  );

  app.put<{ Body: { pricePerKwh?: number | null; currency?: string } }>(
    '/config',
    { schema: updateEnergyConfigSchema, preHandler: app.requireRole('admin') },
    async (req, reply) => {
      try {
        const config = await service.setConfig(req.body);
        app.audit({ action: 'energy.config.update', userId: req.user.sub, ip: req.ip });
        return config;
      } catch (err) {
        if (err instanceof EnergyConfigError) {
          return reply.code(400).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );
};
