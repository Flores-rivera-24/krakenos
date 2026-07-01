import type { CameraManager, CreateCameraRequest, UpdateCameraRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { toCameraRecord, toManagedCamera, type CameraStore } from '../../cameras/camera.store.js';
import {
  createCameraSchema,
  listCamerasSchema,
  removeCameraSchema,
  snapshotSchema,
  updateCameraSchema,
} from './cameras.schemas.js';

interface CameraRoutesOpts {
  cameras: CameraManager;
  /** Store de gestión de cámaras (alta/baja desde la UI, US-148). Sin él, solo lectura. */
  store?: CameraStore;
}

export const camerasRoutes: FastifyPluginAsync<CameraRoutesOpts> = async (app, opts) => {
  const { cameras, store } = opts;

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

  // Gestión de cámaras (alta/edición/baja) — solo admin, si hay store. La `rtspUrl`
  // (con credenciales) se acepta pero **nunca** se devuelve.
  if (store) {
    const adminOnly = app.requireRole('admin');

    app.post<{ Body: CreateCameraRequest }>(
      '/',
      { schema: createCameraSchema, preHandler: adminOnly },
      async (req, reply) => {
        const record = toCameraRecord(req.body);
        await store.upsert(record);
        app.audit({ action: 'camera.add', userId: req.user.sub, detail: record.id, ip: req.ip });
        return reply.code(201).send(toManagedCamera(record));
      },
    );

    app.patch<{ Params: { id: string }; Body: UpdateCameraRequest }>(
      '/:id',
      { schema: updateCameraSchema, preHandler: adminOnly },
      async (req, reply) => {
        const existing = await store.get(req.params.id);
        if (!existing) {
          return reply.code(404).send({ code: 'CAMERA_NOT_FOUND', message: 'Cámara no encontrada' });
        }
        const updated = { ...existing, ...req.body };
        await store.upsert(updated);
        app.audit({ action: 'camera.update', userId: req.user.sub, detail: updated.id, ip: req.ip });
        return toManagedCamera(updated);
      },
    );

    app.delete<{ Params: { id: string } }>(
      '/:id',
      { schema: removeCameraSchema, preHandler: adminOnly },
      async (req, reply) => {
        const removed = await store.removeById(req.params.id);
        if (!removed) {
          return reply.code(404).send({ code: 'CAMERA_NOT_FOUND', message: 'Cámara no encontrada' });
        }
        app.audit({ action: 'camera.remove', userId: req.user.sub, detail: req.params.id, ip: req.ip });
        return reply.code(204).send();
      },
    );
  }
};
