import type { LastSession, LoginRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { loginLockout } from '../../auth/login-lockout.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  sendSession,
  setRefreshCookie,
} from '../../auth/session-cookie.js';
import { publicDisclosure } from '../../config/env.js';
import { hashEmail } from '../../plugins/audit.js';
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

  // Última sesión para la pantalla de login (US-49). Público pero **off por
  // defecto** (US-83, F5): exponer IP+hora del último login admin sin autenticar
  // filtra actividad del admin. Se activa con PUBLIC_LAST_SESSION=true. Nunca
  // devuelve email ni userId.
  app.get('/last-session', { schema: lastSessionSchema }, async (): Promise<LastSession | null> => {
    if (!publicDisclosure.lastSession()) return null;
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
    const { email } = req.body;

    // Lockout por cuenta con backoff (US-77, F3): además del límite por IP, una
    // cuenta con demasiados fallos consecutivos se bloquea temporalmente. Se
    // comprueba para cualquier email (exista o no) → no enumera cuentas.
    const retryAfter = loginLockout.retryAfterSec(email);
    if (retryAfter > 0) {
      app.audit({ action: 'auth.login_locked', detail: hashEmail(email), ip: req.ip });
      return reply
        .code(429)
        .header('retry-after', String(retryAfter))
        .send({
          code: 'AUTH_ACCOUNT_LOCKED',
          message: `Demasiados intentos. Reintenta en ${retryAfter} s.`,
          retryAfter,
        });
    }

    try {
      const user = await service.verifyCredentials(email, req.body.password);
      // Primer factor correcto: limpia el contador de fallos de la cuenta.
      loginLockout.recordSuccess(email);

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

      const session = await service.issueSessionForUserId(user.id);
      app.audit({ action: 'auth.login', userId: session.user.id, ip: req.ip });
      return sendSession(reply, session);
    } catch (err) {
      if (err instanceof AuthError) {
        // Login fallido: evento de seguridad (auditoría + push, US-45) y suma al
        // contador de lockout por cuenta (US-77).
        const lockedSec = loginLockout.recordFailure(email);
        app.audit({ action: 'auth.login_failed', detail: hashEmail(email), ip: req.ip });
        if (lockedSec > 0) app.audit({ action: 'auth.login_locked', detail: hashEmail(email), ip: req.ip });
        return reply.code(401).send({ code: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.post(
    '/refresh',
    {
      schema: refreshSchema,
      // Limita el abuso de refresco/rotación desde una misma IP (defensa en
      // profundidad; el token sigue validándose criptográficamente).
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      // El refresh token llega por la cookie `httpOnly` (US-91), no por el cuerpo.
      const current = readRefreshCookie(req);
      if (!current) {
        return reply.code(401).send({ code: 'AUTH_INVALID_TOKEN', message: 'Sin sesión' });
      }
      try {
        const tokens = await service.refresh(current, req.ip);
        setRefreshCookie(reply, tokens.refreshToken);
        return reply.send({ accessToken: tokens.accessToken, expiresIn: tokens.expiresIn });
      } catch (err) {
        if (err instanceof AuthError) {
          // Refresh inválido/reusado: la cookie ya no sirve, se limpia.
          clearRefreshCookie(reply);
          return reply.code(401).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.post('/logout', { schema: logoutSchema }, async (req, reply) => {
    const current = readRefreshCookie(req);
    if (current) await service.logout(current);
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

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

  app.delete(
    '/sessions',
    { schema: revokeSessionsSchema, preHandler: app.authenticate },
    async (req, reply) => {
      // La sesión a conservar es la actual, identificada por la cookie (US-91):
      // el cliente ya no conoce el refresh token.
      await service.revokeOtherSessions(req.user.sub, readRefreshCookie(req) ?? undefined);
      app.audit({ action: 'auth.sessions.revoke-others', userId: req.user.sub, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
