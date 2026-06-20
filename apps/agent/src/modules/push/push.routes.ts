import type { PushSubscriptionPayload } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { PushService } from './push.service.js';
import { subscribeSchema, unsubscribeSchema, vapidPublicKeySchema } from './push.schemas.js';

interface PushRoutesOpts {
  service: PushService;
}

export const pushRoutes: FastifyPluginAsync<PushRoutesOpts> = async (app, opts) => {
  const { service } = opts;

  // Todas las rutas de push requieren autenticación (cualquier rol).
  app.addHook('preHandler', app.authenticate);

  app.get('/vapid-public-key', { schema: vapidPublicKeySchema }, async () => {
    return { publicKey: await service.getPublicKey() };
  });

  // Guarda o actualiza la suscripción del usuario actual (upsert por endpoint).
  app.post<{ Body: PushSubscriptionPayload }>(
    '/subscribe',
    { schema: subscribeSchema },
    async (req, reply) => {
      const { endpoint, keys } = req.body;
      await app.prisma.pushSubscription.upsert({
        where: { endpoint },
        create: { userId: req.user.sub, endpoint, p256dh: keys.p256dh, auth: keys.auth },
        update: { userId: req.user.sub, p256dh: keys.p256dh, auth: keys.auth },
      });
      return reply.code(204).send();
    },
  );

  // Elimina la suscripción del usuario actual por endpoint.
  app.delete<{ Body: { endpoint: string } }>(
    '/subscribe',
    { schema: unsubscribeSchema },
    async (req, reply) => {
      await app.prisma.pushSubscription.deleteMany({
        where: { endpoint: req.body.endpoint, userId: req.user.sub },
      });
      return reply.code(204).send();
    },
  );
};
