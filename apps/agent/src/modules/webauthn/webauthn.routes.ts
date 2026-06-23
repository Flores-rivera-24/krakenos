import type { FastifyPluginAsync } from 'fastify';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AuthService } from '../auth/auth.service.js';
import { hashEmail } from '../../plugins/audit.js';
import { rateLimitStore } from '../../plugins/rate-limit-store.js';
import type { BackupCodeService } from '../../webauthn/backup-codes.service.js';
import { WebAuthnError, type WebAuthnService } from '../../webauthn/webauthn.service.js';
import {
  authenticateOptionsSchema,
  authenticateVerifySchema,
  backupCodeVerifySchema,
  backupCodesStatusSchema,
  deleteCredentialSchema,
  listCredentialsSchema,
  regenerateBackupCodesSchema,
  registerOptionsSchema,
  registerVerifySchema,
  renameCredentialSchema,
} from './webauthn.schemas.js';

interface WebAuthnRoutesOpts {
  service: WebAuthnService;
  backupCodes: BackupCodeService;
}

export const webauthnRoutes: FastifyPluginAsync<WebAuthnRoutesOpts> = async (app, opts) => {
  const { service, backupCodes } = opts;
  const auth = new AuthService(app);

  /**
   * Límite por IP para los endpoints **públicos** de 2FA (continuación del login):
   * comparte en caliente el mismo presupuesto que `/auth/login` (`loginRateLimit`,
   * US-47), leído en cada petición. Frena la fuerza bruta de códigos de
   * recuperación y el abuso del paso de passkey (US-88).
   */
  const publicMfaRateLimit = {
    rateLimit: { max: () => rateLimitStore.getCurrent(), timeWindow: '1 minute' },
  };

  // ---- Registro de passkey (usuario autenticado) ----

  app.post(
    '/register/options',
    { preHandler: app.authenticate, schema: registerOptionsSchema },
    async (req, reply) => {
      const user = await app.prisma.user.findUnique({ where: { id: req.user.sub } });
      if (!user) return reply.code(401).send({ code: 'AUTH_UNAUTHORIZED', message: 'Usuario no encontrado' });
      return service.generateRegistrationOptions(user);
    },
  );

  app.post<{ Body: { response: RegistrationResponseJSON; name: string } }>(
    '/register/verify',
    { preHandler: app.authenticate, schema: registerVerifySchema },
    async (req, reply) => {
      const user = await app.prisma.user.findUnique({ where: { id: req.user.sub } });
      if (!user) return reply.code(401).send({ code: 'AUTH_UNAUTHORIZED', message: 'Usuario no encontrado' });
      try {
        const credential = await service.verifyRegistration(user, req.body.response, req.body.name);
        app.audit({ action: 'webauthn.register', userId: user.id, detail: req.body.name, ip: req.ip });
        // Al registrar la PRIMERA passkey se generan códigos de recuperación (US-59),
        // que se muestran una sola vez en la respuesta.
        const codes = await backupCodes.generateIfNone(user.id);
        return reply.send(codes ? { credential, backupCodes: codes } : { credential });
      } catch (err) {
        if (err instanceof WebAuthnError) {
          return reply.code(400).send({ code: 'WEBAUTHN_ERROR', message: err.message });
        }
        throw err;
      }
    },
  );

  // ---- Autenticación con passkey (segundo factor del login, público) ----
  //
  // US-51: ambos pasos exigen el token efímero `mfa-pending` emitido por `/auth/login`
  // tras verificar la contraseña. El `sub` del token debe coincidir con el usuario del
  // `email`, de modo que la passkey **suma** un factor en vez de **reemplazar** la
  // contraseña. Sin ese token (o con uno inválido/expirado/de otro usuario) → 401.

  /**
   * Valida el `mfaToken` y que su `sub` sea el usuario del `email`; `null` si no.
   * Con `consume: true` además marca el token de un solo uso (anti-replay): lo usan
   * los pasos que **emiten sesión**; `authenticate/options` no consume (no emite
   * tokens y el mismo `mfaToken` se reutiliza luego en `authenticate/verify`).
   */
  async function resolveMfaUser(email: string, mfaToken: string, consume = false) {
    let sub: string;
    try {
      sub = consume ? auth.consumeMfaPendingToken(mfaToken) : auth.verifyMfaPendingToken(mfaToken);
    } catch {
      return null;
    }
    const user = await app.prisma.user.findUnique({ where: { email } });
    return user && user.id === sub ? user : null;
  }

  app.post<{ Body: { email: string; mfaToken: string } }>(
    '/authenticate/options',
    { schema: authenticateOptionsSchema, config: publicMfaRateLimit },
    async (req, reply) => {
      const user = await resolveMfaUser(req.body.email, req.body.mfaToken);
      if (!user) {
        return reply
          .code(401)
          .send({ code: 'AUTH_INVALID_TOKEN', message: 'Verificación de 2FA no válida' });
      }
      const options = await service.generateAuthenticationOptions(user);
      if (!options) return { available: false };
      return { available: true, options };
    },
  );

  app.post<{ Body: { email: string; mfaToken: string; response: AuthenticationResponseJSON } }>(
    '/authenticate/verify',
    { schema: authenticateVerifySchema, config: publicMfaRateLimit },
    async (req, reply) => {
      // `consume: true` → el mfaToken queda de un solo uso: un intento de segundo
      // factor por token (anti-replay). Un fallo de passkey exige re-login (US-88).
      const user = await resolveMfaUser(req.body.email, req.body.mfaToken, true);
      if (!user) {
        app.audit({ action: 'auth.login_failed', detail: hashEmail(req.body.email), ip: req.ip });
        return reply
          .code(401)
          .send({ code: 'AUTH_INVALID_TOKEN', message: 'Verificación de 2FA no válida' });
      }
      try {
        await service.verifyAuthentication(user, req.body.response);
      } catch (err) {
        if (err instanceof WebAuthnError) {
          app.audit({ action: 'auth.login_failed', detail: hashEmail(req.body.email), ip: req.ip });
          return reply.code(401).send({ code: 'WEBAUTHN_ERROR', message: err.message });
        }
        throw err;
      }
      const session = await auth.issueSessionForUserId(user.id);
      app.audit({ action: 'auth.login', userId: user.id, ip: req.ip });
      return reply.send(session);
    },
  );

  // ---- Códigos de recuperación 2FA (US-59) ----

  // (Re)genera el lote (usuario autenticado): Ajustes → Seguridad. Se muestran una vez.
  app.post(
    '/backup-codes',
    { preHandler: app.authenticate, schema: regenerateBackupCodesSchema },
    async (req) => {
      const codes = await backupCodes.generate(req.user.sub);
      app.audit({ action: 'webauthn.backup-codes.regenerate', userId: req.user.sub, ip: req.ip });
      return { codes };
    },
  );

  // Cuántos códigos sin usar quedan (para la UI; nunca expone los códigos).
  app.get(
    '/backup-codes',
    { preHandler: app.authenticate, schema: backupCodesStatusSchema },
    async (req) => ({ remaining: await backupCodes.remaining(req.user.sub) }),
  );

  // Completa el 2FA con un código en vez de la passkey (público). Exige el mismo
  // `mfaToken` que la verificación con passkey (US-51): el primer factor (contraseña)
  // ya debe estar superado y el `sub` del token debe coincidir con el usuario.
  app.post<{ Body: { email: string; mfaToken: string; code: string } }>(
    '/backup-codes/verify',
    { schema: backupCodeVerifySchema, config: publicMfaRateLimit },
    async (req, reply) => {
      // `consume: true` → un código adivinado por token: junto al rate limit por IP,
      // hace inviable la fuerza bruta de los códigos de recuperación (US-88).
      const user = await resolveMfaUser(req.body.email, req.body.mfaToken, true);
      if (!user) {
        app.audit({ action: 'auth.login_failed', detail: hashEmail(req.body.email), ip: req.ip });
        return reply
          .code(401)
          .send({ code: 'AUTH_INVALID_TOKEN', message: 'Verificación de 2FA no válida' });
      }
      const ok = await backupCodes.consume(user.id, req.body.code);
      if (!ok) {
        app.audit({ action: 'auth.login_failed', detail: hashEmail(req.body.email), ip: req.ip });
        return reply
          .code(401)
          .send({ code: 'WEBAUTHN_ERROR', message: 'Código de recuperación inválido' });
      }
      const session = await auth.issueSessionForUserId(user.id);
      app.audit({ action: 'auth.login', userId: user.id, ip: req.ip });
      return reply.send(session);
    },
  );

  // ---- Gestión de passkeys (usuario autenticado) ----

  app.get(
    '/credentials',
    { preHandler: app.authenticate, schema: listCredentialsSchema },
    async (req) => service.listCredentials(req.user.sub),
  );

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    '/credentials/:id',
    { preHandler: app.authenticate, schema: renameCredentialSchema },
    async (req, reply) => {
      const info = await service.renameCredential(req.user.sub, req.params.id, req.body.name);
      if (!info) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Passkey no encontrada' });
      return reply.send(info);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/credentials/:id',
    { preHandler: app.authenticate, schema: deleteCredentialSchema },
    async (req, reply) => {
      const ok = await service.deleteCredential(req.user.sub, req.params.id);
      if (!ok) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Passkey no encontrada' });
      app.audit({ action: 'webauthn.delete', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
