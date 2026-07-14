import type { UpdateMqttPublishRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { MqttPublisher } from './mqtt-publisher.service.js';
import { getMqttSchema, updateMqttSchema } from './interop.schemas.js';

interface InteropRoutesOpts {
  publisher: MqttPublisher;
}

/**
 * Interop abierta (US-174): configurar la publicación de estados a un broker MQTT
 * local. Admin-only y auditada. El GET devuelve la config **redactada** (sin la
 * contraseña, solo si hay) + el estado en vivo.
 */
export const interopRoutes: FastifyPluginAsync<InteropRoutesOpts> = async (app, opts) => {
  const { publisher } = opts;

  app.get('/mqtt', { preHandler: app.requireRole('admin'), schema: getMqttSchema }, async () => ({
    config: await publisher.getConfig(),
    status: publisher.getStatus(),
  }));

  app.put<{ Body: UpdateMqttPublishRequest }>(
    '/mqtt',
    { preHandler: app.requireRole('admin'), schema: updateMqttSchema },
    async (req) => {
      const config = await publisher.setConfig(req.body);
      app.audit({ action: 'interop.mqtt.update', userId: req.user.sub, ip: req.ip });
      return { config, status: publisher.getStatus() };
    },
  );
};
