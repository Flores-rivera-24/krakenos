import type { WellbeingRange } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { WellbeingService } from './wellbeing.service.js';
import { wellbeingUsageSchema } from './wellbeing.schemas.js';

interface WellbeingRoutesOpts {
  service: WellbeingService;
}

/**
 * Bienestar digital (US-184): uso de internet por persona. Lectura autenticada,
 * pero con **privacidad por rol** aplicada en el servicio: un admin ve todo el
 * hogar; cualquier otro rol solo ve su propio uso (la autoridad es del servidor).
 */
export const wellbeingRoutes: FastifyPluginAsync<WellbeingRoutesOpts> = async (app, opts) => {
  const { service } = opts;

  app.get<{ Querystring: { range?: WellbeingRange } }>(
    '/usage',
    { schema: wellbeingUsageSchema, preHandler: app.authenticate },
    async (req) =>
      service.usageByPerson(req.query.range ?? 'week', {
        sub: req.user.sub,
        role: req.user.role,
      }),
  );
};
