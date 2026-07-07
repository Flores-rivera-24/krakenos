import type {
  AssignRoomRequest,
  CreateRoomRequest,
  RoomGroupActionRequest,
  UpdateRoomRequest,
} from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import type { RoomService } from './rooms.service.js';
import {
  assignRoomSchema,
  createRoomSchema,
  deleteRoomSchema,
  listRoomsSchema,
  roomActionSchema,
  updateRoomSchema,
} from './rooms.schemas.js';

interface RoomsRoutesOpts {
  service: RoomService;
}

/**
 * Habitaciones y grupos (US-165). Lectura = autenticado; escritura = admin y
 * auditada. La acción de grupo y la asignación también son escrituras (mutan
 * estado del hogar), por eso son admin.
 */
export const roomsRoutes: FastifyPluginAsync<RoomsRoutesOpts> = async (app, opts) => {
  const { service } = opts;
  const adminOnly = app.requireRole('admin');

  app.get('/', { schema: listRoomsSchema, preHandler: app.authenticate }, async () => service.list());

  app.post<{ Body: CreateRoomRequest }>(
    '/',
    { schema: createRoomSchema, preHandler: adminOnly },
    async (req, reply) => {
      const room = await service.create(req.body);
      app.audit({ action: 'room.create', userId: req.user.sub, detail: `${room.id} · ${room.name}`, ip: req.ip });
      return reply.code(201).send(room);
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateRoomRequest }>(
    '/:id',
    { schema: updateRoomSchema, preHandler: adminOnly },
    async (req, reply) => {
      const room = await service.update(req.params.id, req.body);
      if (!room) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Habitación no encontrada' });
      }
      app.audit({ action: 'room.update', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.send(room);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: deleteRoomSchema, preHandler: adminOnly },
    async (req, reply) => {
      const ok = await service.remove(req.params.id);
      if (!ok) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Habitación no encontrada' });
      }
      app.audit({ action: 'room.delete', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.code(204).send();
    },
  );

  // Asignar/quitar un dispositivo (de red o IoT) a una habitación.
  app.put<{ Body: AssignRoomRequest }>(
    '/assign',
    { schema: assignRoomSchema, preHandler: adminOnly },
    async (req, reply) => {
      const ok = await service.assign(req.body);
      if (!ok) {
        return reply
          .code(404)
          .send({ code: 'NOT_FOUND', message: 'Dispositivo o habitación no encontrados' });
      }
      app.audit({
        action: 'room.assign',
        userId: req.user.sub,
        detail: `${req.body.kind}:${req.body.ref} → ${req.body.roomId ?? 'sin habitación'}`,
        ip: req.ip,
      });
      return reply.code(204).send();
    },
  );

  // Acción de grupo sobre los IoT de la habitación (encender/apagar/atenuar todo).
  app.post<{ Params: { id: string }; Body: RoomGroupActionRequest }>(
    '/:id/action',
    { schema: roomActionSchema, preHandler: adminOnly },
    async (req, reply) => {
      const result = await service.runGroupAction(req.params.id, req.body);
      if (!result) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Habitación no encontrada' });
      }
      app.audit({
        action: 'room.action',
        userId: req.user.sub,
        detail: `${req.params.id} · ${result.applied} ok, ${result.failed.length} fallo(s)`,
        ip: req.ip,
      });
      return reply.send(result);
    },
  );
};
