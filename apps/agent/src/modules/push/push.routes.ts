import type { PushSubscriptionPayload } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { EgressBlockedError } from '../../net/egress.js';
import { assertPushEndpointAllowed } from '../../push/endpoint.js';
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
      // El endpoint es un destino al que el agente hará POST: se valida contra la
      // política de egress ANTES de persistirlo (AUD3-01). Sin esto, cualquier rol
      // podía apuntar los avisos del hogar a un servidor propio o a la LAN.
      try {
        await assertPushEndpointAllowed(endpoint);
      } catch (err) {
        if (err instanceof EgressBlockedError) {
          return reply.code(400).send({
            code: 'PUSH_ENDPOINT_INVALID',
            message: 'El endpoint de notificaciones no es un destino permitido.',
          });
        }
        throw err;
      }
      // Un endpoint ya registrado por OTRO usuario no se reasigna: quien lo conociera
      // se quedaría sus avisos (alarma incluida). findUnique + escritura van en una
      // transacción; la carrera residual la cierra el índice único de `endpoint`.
      const taken = await app.prisma.$transaction(async (tx) => {
        const existing = await tx.pushSubscription.findUnique({ where: { endpoint } });
        if (existing && existing.userId !== req.user.sub) return true;
        if (existing) {
          await tx.pushSubscription.update({
            where: { endpoint },
            data: { p256dh: keys.p256dh, auth: keys.auth },
          });
        } else {
          await tx.pushSubscription.create({
            data: { userId: req.user.sub, endpoint, p256dh: keys.p256dh, auth: keys.auth },
          });
        }
        return false;
      });
      if (taken) {
        return reply.code(409).send({
          code: 'PUSH_ENDPOINT_TAKEN',
          message: 'Ese endpoint de notificaciones ya pertenece a otro usuario.',
        });
      }
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
