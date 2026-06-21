import type {
  LastSession,
  LoginRequest,
  RefreshRequest,
  RevokeSessionsRequest,
} from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { rateLimitStore } from '../../plugins/rate-limit-store.js';
import { AuthError, AuthService } from './auth.service.js';
import {
  lastSessionSchema,
  listSessionsSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  revokeSessionsSchema,
  statusSchema,
} from './auth.schemas.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const service = new AuthService(app);

  // Límite de intentos de login configurable y **en caliente** (US-41/US-47):
  // se inicializa desde la setting `loginRateLimit` y la ruta lo lee del store en
  // cada petición, de modo que un cambio de ajuste tiene efecto sin reiniciar.
  const rateRow = await app.prisma.setting.findUnique({ where: { key: 'loginRateLimit' } });
  if (Number(rateRow?.value) > 0) rateLimitStore.update(Number(rateRow!.value));

  app.get('/status', { schema: statusSchema, preHandler: app.authenticate }, async (req, reply) => {
    const user = await service.getById(req.user.sub);
    if (!user) {
      return reply.code(401).send({ code: 'AUTH_UNAUTHORIZED', message: 'Usuario no encontrado' });
    }
    return reply.send(user);
  });

  // Última sesión para la pantalla de login (US-49). Público: solo devuelve
  // timestamp + IP del último login exitoso, nunca email ni userId.
  app.get('/last-session', { schema: lastSessionSchema }, async (): Promise<LastSession | null> => {
    const entry = await app.prisma.auditLog.findFirst({
      where: { action: 'auth.login' },
      orderBy: { createdAt: 'desc' },
    });
    if (!entry) return null;
    return { timestamp: entry.createdAt.toISOString(), ip: entry.ip ?? '' };
  });

  app.post<{ Body: LoginRequest }>(
    '/login',
    {
      schema: loginSchema,
      config: { rateLimit: { max: () => rateLimitStore.getCurrent(), timeWindow: '1 minute' } },
    },
    async (req, reply) => {
    try {
      const user = await service.verifyCredentials(req.body.email, req.body.password);

      // 2FA WebAuthn (US-50/US-51): si el usuario tiene passkeys, no se emiten tokens
      // todavía. Se devuelve un token efímero `mfa-pending` que acredita la contraseña
      // ya superada y que el paso de passkey debe presentar (atando ambos factores).
      const passkeys = await app.prisma.webAuthnCredential.count({ where: { userId: user.id } });
      if (passkeys > 0) {
        return reply.send({
          requiresWebAuthn: true,
          email: user.email,
          mfaToken: service.issueMfaPendingToken(user.id),
        });
      }

      const result = await service.issueSessionForUserId(user.id);
      app.audit({ action: 'auth.login', userId: result.user.id, ip: req.ip });
      return reply.send(result);
    } catch (err) {
      if (err instanceof AuthError) {
        // Login fallido: evento de seguridad (auditoría + push, US-45).
        app.audit({ action: 'auth.login_failed', detail: req.body.email, ip: req.ip });
        return reply.code(401).send({ code: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.post<{ Body: RefreshRequest }>(
    '/refresh',
    {
      schema: refreshSchema,
      // Limita el abuso de refresco/rotación desde una misma IP (defensa en
      // profundidad; el token sigue validándose criptográficamente).
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
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

  // ---- Sesiones (US-41) ----

  app.get<{ Querystring: { userId?: string } }>(
    '/sessions',
    { schema: listSessionsSchema, preHandler: app.authenticate },
    async (req) => {
      // Solo un admin puede inspeccionar las sesiones de otro usuario.
      const target =
        req.query.userId && req.user.role === 'admin' ? req.query.userId : req.user.sub;
      return service.listSessions(target);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const ok = await service.revokeSession(
        req.params.id,
        req.user.sub,
        req.user.role === 'admin',
      );
      if (!ok) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Sesión no encontrada' });
      app.audit({ action: 'auth.session.revoke', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.code(204).send();
    },
  );

  app.delete<{ Body: RevokeSessionsRequest }>(
    '/sessions',
    { schema: revokeSessionsSchema, preHandler: app.authenticate },
    async (req, reply) => {
      await service.revokeOtherSessions(req.user.sub, req.body?.keepRefreshToken);
      app.audit({ action: 'auth.sessions.revoke-others', userId: req.user.sub, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
