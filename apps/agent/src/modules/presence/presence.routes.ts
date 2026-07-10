import type { SetHomeModeRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { PresenceService } from './presence.service.js';
import {
  getPresenceSchema,
  getPresenceTimelineSchema,
  setHomeModeSchema,
} from './presence.schemas.js';

interface PresenceRoutesOpts {
  service: PresenceService;
}

/**
 * Modos del hogar + presencia (US-169). Lectura = autenticado pero **acotada por
 * rol dentro del servicio** (admin ve a todas las personas; el resto solo a sí
 * mismo — la presencia ajena es dato sensible). Cambiar el modo es operar el
 * hogar: capacidad `home.control` (admin y member, US-179), auditado.
 */
export const presenceRoutes: FastifyPluginAsync<PresenceRoutesOpts> = async (app, opts) => {
  const { service } = opts;

  app.get('/', { schema: getPresenceSchema, preHandler: app.authenticate }, async (req) =>
    service.getState({ sub: req.user.sub, role: req.user.role }),
  );

  app.get<{ Querystring: { limit?: number } }>(
    '/timeline',
    { schema: getPresenceTimelineSchema, preHandler: app.authenticate },
    async (req) =>
      service.timeline({ sub: req.user.sub, role: req.user.role }, req.query.limit ?? 50),
  );

  app.post<{ Body: SetHomeModeRequest }>(
    '/mode',
    { schema: setHomeModeSchema, preHandler: app.requireCapability('home.control') },
    async (req) => {
      await service.setMode(req.body.mode, 'manual');
      app.audit({
        action: 'presence.mode.set',
        userId: req.user.sub,
        detail: req.body.mode,
        ip: req.ip,
      });
      return service.getState({ sub: req.user.sub, role: req.user.role });
    },
  );
};
