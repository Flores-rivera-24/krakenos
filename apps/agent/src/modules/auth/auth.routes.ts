import type { ChangePasswordRequest, LastSession, LoginRequest } from '@krakenos/types';
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
import { BackupCodeService } from '../../webauthn/backup-codes.service.js';
import { AuthError, AuthService } from './auth.service.js';
import {
  changePasswordSchema,
  recoverSchema,
  lastSessionSchema,
  listSessionsSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  revokeSessionsSchema,
  statusSchema,
  updateLocaleSchema,
  updateUiModeSchema,
} from './auth.schemas.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const service = new AuthService(app);
  const backupCodes = new BackupCodeService(app.prisma);

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
    // Defecto `true`: es lo que hacía la cookie antes de US-266, así que un
    // cliente que no manda el campo no cambia de comportamiento.
    const keepSignedIn = req.body.keepSignedIn !== false;

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
          mfaToken: service.issueMfaPendingToken(user.id, keepSignedIn),
        });
      }

      const session = await service.issueSessionForUserId(user.id, keepSignedIn);
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

  /**
   * Entrar con un código de recuperación, **sin la contraseña** (US-266).
   *
   * El agujero que cierra: perder la contraseña dejaba la instalación inservible
   * salvo que otro admin la resetease o alguien entrase por SSH a correr
   * `reset-admin.js`. La pantalla no lo mencionaba siquiera, así que quien la
   * perdía se quedaba mirando un formulario sin salida visible.
   *
   * Por qué códigos y no un enlace por email: SMTP es **opcional y viene apagado**,
   * así que un «te mandamos un correo» respondería «configura un servidor de
   * correo primero» en la mayoría de instalaciones. Y hay un motivo de seguridad
   * encima: con reset por email, quien tome la cuenta de correo se queda con el
   * firewall y las cámaras de la casa — el correo pasaría a ser un factor más
   * débil que la propia contraseña. Los códigos ya existían para el 2FA (US-59):
   * esto **extiende una pieza probada**, no inventa una credencial nueva.
   *
   * Un código es una credencial de pleno derecho, así que este camino lleva las
   * mismas defensas que el login —límite por IP y lockout por cuenta con backoff—
   * y responde **siempre igual** ante un correo que no existe y un código
   * incorrecto: si no, sería un oráculo para enumerar cuentas.
   */
  app.post<{ Body: { email: string; code: string } }>(
    '/recover',
    {
      schema: recoverSchema,
      config: { rateLimit: { max: () => rateLimitStore.getCurrent(), timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { email, code } = req.body;

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

      const fallo = () => {
        const lockedSec = loginLockout.recordFailure(email);
        app.audit({ action: 'auth.login_failed', detail: hashEmail(email), ip: req.ip });
        if (lockedSec > 0) {
          app.audit({ action: 'auth.login_locked', detail: hashEmail(email), ip: req.ip });
        }
        return reply
          .code(401)
          .send({ code: 'AUTH_INVALID_CODE', message: 'Correo o código incorrectos.' });
      };

      const user = await app.prisma.user.findUnique({ where: { email } });
      // Mismo camino que un código malo: un 404 aquí diría qué correos existen.
      if (!user) return fallo();

      const ok = await backupCodes.consume(user.id, code);
      if (!ok) return fallo();

      loginLockout.recordSuccess(email);
      try {
        // Sesión **no persistente** a propósito: se entra a arreglar una cuenta,
        // no a quedarse. Dura lo que dure el navegador abierto, que es de sobra
        // para poner una contraseña nueva.
        const session = await service.issueSessionForUserId(user.id, false);
        // Evento de seguridad propio, no un `auth.login` más: alguien ha entrado
        // sin la contraseña. Si no fuiste tú, hay que enterarse.
        app.audit({ action: 'auth.recovery_used', userId: user.id, ip: req.ip });
        return sendSession(reply, session);
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.code(401).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

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
        setRefreshCookie(reply, tokens.refreshToken, tokens.persistent);
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

  // Cambio de la propia contraseña (US-101) — auto-servicio de cualquier usuario
  // autenticado. Verifica la actual, guarda el nuevo hash y conserva solo la sesión
  // actual (revoca las demás), de modo que un cambio expulse a sesiones ajenas.
  app.post<{ Body: ChangePasswordRequest }>(
    '/change-password',
    {
      schema: changePasswordSchema,
      preHandler: app.authenticate,
      // Verifica la contraseña actual (bcrypt) → oráculo de adivinación si roban un
      // access token. Limita los intentos (defensa en profundidad).
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    },
    async (req, reply) => {
      try {
        await service.changePassword(req.user.sub, req.body.currentPassword, req.body.newPassword);
      } catch (err) {
        if (err instanceof AuthError) {
          // Contraseña actual incorrecta → 400 (no 401): no es un fallo de sesión,
          // y evita que el cliente dispare su ruta de refresco ante un 401.
          const status = err.code === 'AUTH_INVALID_CREDENTIALS' ? 400 : 401;
          return reply.code(status).send({ code: err.code, message: err.message });
        }
        throw err;
      }
      await service.revokeOtherSessions(req.user.sub, readRefreshCookie(req) ?? undefined);
      app.audit({ action: 'auth.password.change', userId: req.user.sub, ip: req.ip });
      return reply.code(204).send();
    },
  );

  // Modo de la interfaz (US-176): autoservicio, solo presentación — no cambia
  // permisos (la authz de cada ruta sigue en el servidor).
  app.patch<{ Body: { uiMode: 'simple' | 'advanced' } }>(
    '/ui-mode',
    { schema: updateUiModeSchema, preHandler: app.authenticate },
    async (req) => service.setUiMode(req.user.sub, req.body.uiMode),
  );

  // Idioma de la interfaz (US-177): autoservicio, solo presentación — el
  // frontend traduce con este valor; la authz de cada ruta no cambia.
  app.patch<{ Body: { locale: 'es' | 'en' } }>(
    '/locale',
    { schema: updateLocaleSchema, preHandler: app.authenticate },
    async (req) => service.setLocale(req.user.sub, req.body.locale),
  );
};
