import type { FastifyPluginAsync } from 'fastify';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AuthService } from '../auth/auth.service.js';
import { WebAuthnError, type WebAuthnService } from '../../webauthn/webauthn.service.js';
import {
  authenticateOptionsSchema,
  authenticateVerifySchema,
  deleteCredentialSchema,
  listCredentialsSchema,
  registerOptionsSchema,
  registerVerifySchema,
  renameCredentialSchema,
} from './webauthn.schemas.js';

interface WebAuthnRoutesOpts {
  service: WebAuthnService;
}

export const webauthnRoutes: FastifyPluginAsync<WebAuthnRoutesOpts> = async (app, opts) => {
  const { service } = opts;
  const auth = new AuthService(app);

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
        const info = await service.verifyRegistration(user, req.body.response, req.body.name);
        app.audit({ action: 'webauthn.register', userId: user.id, detail: req.body.name, ip: req.ip });
        return reply.send(info);
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

  /** Valida el `mfaToken` y que su `sub` sea el usuario del `email`; `null` si no. */
  async function resolveMfaUser(email: string, mfaToken: string) {
    let sub: string;
    try {
      sub = auth.verifyMfaPendingToken(mfaToken);
    } catch {
      return null;
    }
    const user = await app.prisma.user.findUnique({ where: { email } });
    return user && user.id === sub ? user : null;
  }

  app.post<{ Body: { email: string; mfaToken: string } }>(
    '/authenticate/options',
    { schema: authenticateOptionsSchema },
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
    { schema: authenticateVerifySchema },
    async (req, reply) => {
      const user = await resolveMfaUser(req.body.email, req.body.mfaToken);
      if (!user) {
        app.audit({ action: 'auth.login_failed', detail: req.body.email, ip: req.ip });
        return reply
          .code(401)
          .send({ code: 'AUTH_INVALID_TOKEN', message: 'Verificación de 2FA no válida' });
      }
      try {
        await service.verifyAuthentication(user, req.body.response);
      } catch (err) {
        if (err instanceof WebAuthnError) {
          app.audit({ action: 'auth.login_failed', detail: req.body.email, ip: req.ip });
          return reply.code(401).send({ code: 'WEBAUTHN_ERROR', message: err.message });
        }
        throw err;
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
