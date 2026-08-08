import type {
  AcceptInvitationRequest,
  AccessRequestStatus,
  CreateAccessRequestRequest,
  CreateInvitationRequest,
  DecideAccessRequestRequest,
} from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { sendSession } from '../../auth/session-cookie.js';
import { AuthService } from '../auth/auth.service.js';
import { AccessRequestError, AccessRequestsService } from './access-requests.service.js';
import { InvitationError, InvitationsService } from './invitations.service.js';
import {
  acceptInvitationSchema,
  createAccessRequestSchema,
  createInvitationSchema,
  decideAccessRequestSchema,
  listAccessRequestsSchema,
  listInvitationsSchema,
  previewInvitationSchema,
  revokeInvitationSchema,
} from './onboarding.schemas.js';

/** Ruta pública que abre quien recibe el enlace. Vive aquí para no duplicarla en la web. */
export function invitationPath(token: string): string {
  return `/invitacion/${token}`;
}

async function homeName(app: Parameters<FastifyPluginAsync>[0]): Promise<string> {
  const row = await app.prisma.setting.findUnique({ where: { key: 'homeName' } });
  return row?.value || 'Mi hogar';
}

/**
 * Invitaciones de un solo uso (US-267): `/api/invitations`.
 *
 * Tres rutas de admin y **dos públicas** (abrir el enlace y aceptarlo). Las públicas
 * llevan límite por IP: el token es de 192 bits, así que la fuerza bruta no es una
 * amenaza real, pero un endpoint público sin techo lo es igualmente.
 */
export const invitationsRoutes: FastifyPluginAsync = async (app) => {
  const service = new InvitationsService(app.prisma);
  const auth = new AuthService(app);
  // Admin RE-VERIFICADO en la DB, no solo el claim del token: mismo criterio que el
  // resto de la gestión de usuarios.
  const adminOnly = app.requireActiveAdmin;

  app.get('/', { schema: listInvitationsSchema, preHandler: adminOnly }, async () => service.list());

  app.post<{ Body: CreateInvitationRequest }>(
    '/',
    { schema: createInvitationSchema, preHandler: adminOnly },
    async (req, reply) => {
      try {
        const { invitation, token } = await service.create(req.body, req.user.sub);
        app.audit({
          action: 'user.invite',
          userId: req.user.sub,
          detail: `${invitation.id} · ${invitation.role}`,
          ip: req.ip,
        });
        return reply
          .code(201)
          .send({ invitation, token, path: invitationPath(token) });
      } catch (err) {
        if (err instanceof InvitationError) {
          return reply.code(409).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: revokeInvitationSchema, preHandler: adminOnly },
    async (req, reply) => {
      const ok = await service.revoke(req.params.id);
      if (!ok) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Invitación no encontrada' });
      }
      app.audit({
        action: 'user.invite_revoke',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.code(204).send();
    },
  );

  // ---- Públicas: quien recibió el enlace ----

  app.get<{ Params: { token: string } }>(
    '/redeem/:token',
    {
      schema: previewInvitationSchema,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const preview = await service.preview(req.params.token, await homeName(app));
      if (!preview) {
        return reply
          .code(404)
          .send({ code: 'INVITATION_INVALID', message: 'Invitación no válida o caducada' });
      }
      return preview;
    },
  );

  app.post<{ Params: { token: string }; Body: AcceptInvitationRequest }>(
    '/redeem/:token',
    {
      schema: acceptInvitationSchema,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      try {
        const userId = await service.accept(req.params.token, req.body);
        app.audit({ action: 'user.invite_accept', userId, ip: req.ip });
        // Sesión persistente: es un alta normal, quien entra viene para quedarse.
        const session = await auth.issueSessionForUserId(userId, true);
        reply.code(201);
        return sendSession(reply, session);
      } catch (err) {
        if (err instanceof InvitationError) {
          const status = err.code === 'PASSWORD_TOO_SHORT' ? 400 : 404;
          return reply.code(status).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );
};

/**
 * Solicitudes de acceso (US-268): `/api/access-requests`.
 *
 * Una ruta pública (pedir) y dos de admin (ver y decidir). Aprobar **no** crea la
 * cuenta con una contraseña puesta a dedo: emite una invitación, de modo que la
 * contraseña la siga eligiendo quien la va a usar.
 */
export const accessRequestsRoutes: FastifyPluginAsync = async (app) => {
  const service = new AccessRequestsService(app.prisma);
  const invitations = new InvitationsService(app.prisma);
  const adminOnly = app.requireActiveAdmin;

  app.post<{ Body: CreateAccessRequestRequest }>(
    '/',
    {
      schema: createAccessRequestSchema,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      await service.request(req.body);
      // 202 SIEMPRE, pase lo que pase por dentro. Si la respuesta variase entre
      // «correo nuevo» y «ese correo ya tiene cuenta», cualquiera podría averiguar
      // desde fuera quién vive en la casa probando correos.
      app.audit({ action: 'user.access_requested', detail: req.body.email, ip: req.ip });
      return reply.code(202).send();
    },
  );

  app.get<{ Querystring: { status?: AccessRequestStatus } }>(
    '/',
    { schema: listAccessRequestsSchema, preHandler: adminOnly },
    async (req) => service.list(req.query.status),
  );

  app.post<{ Params: { id: string }; Body: DecideAccessRequestRequest }>(
    '/:id/decide',
    { schema: decideAccessRequestSchema, preHandler: adminOnly },
    async (req, reply) => {
      const { decision, role } = req.body;
      if (decision === 'approve' && role === undefined) {
        return reply
          .code(400)
          .send({ code: 'ROLE_REQUIRED', message: 'Hay que elegir un rol para aprobar' });
      }
      try {
        const request = await service.decide(req.params.id, decision, req.user.sub);
        app.audit({
          action: decision === 'approve' ? 'user.access_approved' : 'user.access_rejected',
          userId: req.user.sub,
          detail: request.id,
          ip: req.ip,
        });
        if (decision === 'reject') return { request };

        // Aprobar emite una INVITACIÓN, no una contraseña. Es el punto de toda la
        // historia: que la contraseña no la teclee nunca el admin.
        const { invitation, token } = await invitations.create(
          { email: request.email, displayName: request.displayName, role: role! },
          req.user.sub,
        );
        return { request, invitation: { invitation, token, path: invitationPath(token) } };
      } catch (err) {
        if (err instanceof AccessRequestError) {
          return reply
            .code(err.code === 'NOT_FOUND' ? 404 : 409)
            .send({ code: err.code, message: err.message });
        }
        if (err instanceof InvitationError) {
          return reply.code(409).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );
};
