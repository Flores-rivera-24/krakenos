import type { UpdateMatterBridgeRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { MatterBridgeService } from './matter-bridge.service.js';
import { getMatterBridgeSchema, updateMatterBridgeSchema } from './matter-bridge.schemas.js';

interface MatterBridgeRoutesOpts {
  service: MatterBridgeService;
}

/**
 * Puente Matter (US-171). Lectura del estado autenticada (para pintar el QR y el
 * catálogo); activar/desactivar y elegir los dispositivos expuestos es **solo
 * admin** y auditado (es una superficie que expone el hogar a asistentes).
 */
export const matterBridgeRoutes: FastifyPluginAsync<MatterBridgeRoutesOpts> = async (app, opts) => {
  const { service } = opts;

  app.get('/', { schema: getMatterBridgeSchema, preHandler: app.authenticate }, async () =>
    service.getState(),
  );

  app.put<{ Body: UpdateMatterBridgeRequest }>(
    '/',
    { schema: updateMatterBridgeSchema, preHandler: app.requireRole('admin') },
    async (req) => {
      const state = await service.update(req.body);
      app.audit({
        action: 'matter.bridge.update',
        userId: req.user.sub,
        detail: `enabled=${state.enabled} devices=${state.endpoints.length}`,
        ip: req.ip,
      });
      return state;
    },
  );
};
