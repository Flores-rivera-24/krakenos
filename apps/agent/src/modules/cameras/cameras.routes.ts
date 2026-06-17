import type { CameraManager } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { listCamerasSchema, snapshotSchema } from './cameras.schemas.js';

interface CameraRoutesOpts {
  cameras: CameraManager;
}

export const camerasRoutes: FastifyPluginAsync<CameraRoutesOpts> = async (app, opts) => {
  const { cameras } = opts;

  app.addHook('preHandler', app.authenticate);

  app.get('/', { schema: listCamerasSchema }, async () => {
    return cameras.listCameras();
  });

  app.get<{ Params: { id: string } }>(
    '/:id/snapshot',
    { schema: snapshotSchema },
    async (req, reply) => {
      const snapshot = await cameras.getSnapshot(req.params.id);
      if (!snapshot) {
        return reply
          .code(404)
          .send({ code: 'CAMERA_UNAVAILABLE', message: 'Cámara no encontrada o sin señal' });
      }
      return reply.send(snapshot);
    },
  );
};
