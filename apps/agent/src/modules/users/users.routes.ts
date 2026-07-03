import type { AdminResetPasswordRequest, CreateUserRequest, UpdateUserRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { UserError, UsersService } from './users.service.js';
import {
  createUserSchema,
  deleteUserSchema,
  listUsersSchema,
  resetPasswordSchema,
  updateUserSchema,
} from './users.schemas.js';

/**
 * Gestión de usuarios (US-101). Todo el módulo es **admin-only** y **auditado**.
 * Desbloquea el uso multi-usuario: hogar con varios miembros y pyme con personal.
 */
export const usersRoutes: FastifyPluginAsync = async (app) => {
  const service = new UsersService(app);
  const adminOnly = app.requireRole('admin');

  app.get('/', { schema: listUsersSchema, preHandler: adminOnly }, async () => service.list());

  app.post<{ Body: CreateUserRequest }>(
    '/',
    { schema: createUserSchema, preHandler: adminOnly },
    async (req, reply) => {
      try {
        const user = await service.create(req.body);
        app.audit({
          action: 'user.create',
          userId: req.user.sub,
          detail: `${user.id} · ${user.role}`,
          ip: req.ip,
        });
        return reply.code(201).send(user);
      } catch (err) {
        if (err instanceof UserError) {
          return reply.code(409).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateUserRequest }>(
    '/:id',
    { schema: updateUserSchema, preHandler: adminOnly },
    async (req, reply) => {
      try {
        const result = await service.update(req.params.id, req.body);
        if (!result) {
          return reply.code(404).send({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
        }
        app.audit({
          action: 'user.update',
          userId: req.user.sub,
          detail: req.params.id,
          ip: req.ip,
        });
        return reply.send(result.user);
      } catch (err) {
        if (err instanceof UserError) {
          return reply.code(409).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: AdminResetPasswordRequest }>(
    '/:id/password',
    { schema: resetPasswordSchema, preHandler: adminOnly },
    async (req, reply) => {
      const ok = await service.resetPassword(req.params.id, req.body.password);
      if (!ok) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
      }
      app.audit({
        action: 'user.reset_password',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: deleteUserSchema, preHandler: adminOnly },
    async (req, reply) => {
      try {
        const ok = await service.remove(req.params.id, req.user.sub);
        if (!ok) {
          return reply.code(404).send({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });
        }
        app.audit({
          action: 'user.delete',
          userId: req.user.sub,
          detail: req.params.id,
          ip: req.ip,
        });
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof UserError) {
          return reply.code(409).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );
};
