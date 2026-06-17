import type { LoginRequest, RefreshRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { AuthError, AuthService } from './auth.service.js';
import { loginSchema, logoutSchema, refreshSchema, statusSchema } from './auth.schemas.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const service = new AuthService(app);

  app.get('/status', { schema: statusSchema, preHandler: app.authenticate }, async (req, reply) => {
    const user = await service.getById(req.user.sub);
    if (!user) {
      return reply.code(401).send({ code: 'AUTH_UNAUTHORIZED', message: 'Usuario no encontrado' });
    }
    return reply.send(user);
  });

  app.post<{ Body: LoginRequest }>('/login', { schema: loginSchema }, async (req, reply) => {
    try {
      const result = await service.login(req.body.email, req.body.password);
      return reply.send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(401).send({ code: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.post<{ Body: RefreshRequest }>(
    '/refresh',
    { schema: refreshSchema },
    async (req, reply) => {
      try {
        const tokens = await service.refresh(req.body.refreshToken);
        return reply.send(tokens);
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.code(401).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Body: RefreshRequest }>(
    '/logout',
    { schema: logoutSchema },
    async (req, reply) => {
      await service.logout(req.body.refreshToken);
      return reply.code(204).send();
    },
  );
};
