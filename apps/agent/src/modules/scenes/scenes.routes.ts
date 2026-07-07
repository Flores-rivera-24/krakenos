import type { CaptureSceneRequest, CreateSceneRequest, UpdateSceneRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { SceneService } from './scenes.service.js';
import {
  captureSceneSchema,
  createSceneSchema,
  deleteSceneSchema,
  listScenesSchema,
  runSceneSchema,
  updateSceneSchema,
} from './scenes.schemas.js';

interface ScenesRoutesOpts {
  service: SceneService;
}

/**
 * Escenas de un toque (US-166). Lectura = autenticado; crear/editar/borrar/ejecutar
 * = admin y auditado (ejecutar muta el estado del hogar). La captura de estado solo
 * lee el IoT actual → autenticado.
 */
export const scenesRoutes: FastifyPluginAsync<ScenesRoutesOpts> = async (app, opts) => {
  const { service } = opts;
  const adminOnly = app.requireRole('admin');

  app.get('/', { schema: listScenesSchema, preHandler: app.authenticate }, async () => service.list());

  app.post<{ Body: CreateSceneRequest }>(
    '/',
    { schema: createSceneSchema, preHandler: adminOnly },
    async (req, reply) => {
      const scene = await service.create(req.body);
      app.audit({ action: 'scene.create', userId: req.user.sub, detail: `${scene.id} · ${scene.name}`, ip: req.ip });
      return reply.code(201).send(scene);
    },
  );

  // Captura del estado actual de N dispositivos como acciones (para el editor).
  app.post<{ Body: CaptureSceneRequest }>(
    '/capture',
    { schema: captureSceneSchema, preHandler: app.authenticate },
    async (req) => service.captureState(req.body.deviceIds),
  );

  app.patch<{ Params: { id: string }; Body: UpdateSceneRequest }>(
    '/:id',
    { schema: updateSceneSchema, preHandler: adminOnly },
    async (req, reply) => {
      const scene = await service.update(req.params.id, req.body);
      if (!scene) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Escena no encontrada' });
      app.audit({ action: 'scene.update', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.send(scene);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: deleteSceneSchema, preHandler: adminOnly },
    async (req, reply) => {
      const ok = await service.remove(req.params.id);
      if (!ok) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Escena no encontrada' });
      app.audit({ action: 'scene.delete', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/run',
    { schema: runSceneSchema, preHandler: adminOnly },
    async (req, reply) => {
      const result = await service.run(req.params.id);
      if (!result) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Escena no encontrada' });
      app.audit({
        action: 'scene.run',
        userId: req.user.sub,
        detail: `${req.params.id} · ${result.applied} ok, ${result.failed.length} fallo(s)`,
        ip: req.ip,
      });
      return reply.send(result);
    },
  );
};
