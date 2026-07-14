import type {
  ApiTokenInfo,
  CreateApiTokenRequest,
  CreateApiTokenResponse,
  UserRole,
} from '@krakenos/types';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { allowedScopesFor, generateApiToken, parseScopes } from '../../auth/api-token.js';
import { createTokenSchema, deleteTokenSchema, listTokensSchema } from './tokens.schemas.js';

/**
 * Tokens personales de API (US-174). **Autoservicio**: cada usuario gestiona los
 * suyos con su sesión. Se gestionan **solo con sesión** (un token de API no puede
 * crear/listar/revocar tokens — eso sería administración). Los scopes que puede
 * conceder nunca superan las capacidades de su rol.
 */
export const tokensRoutes: FastifyPluginAsync = async (app) => {
  /** Rechaza (403) si la petición viene autenticada con un token de API. */
  const rejectApiToken = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.apiScopes) {
      void reply.code(403).send({
        code: 'API_TOKEN_FORBIDDEN',
        message: 'Los tokens de API no gestionan tokens; usa tu sesión.',
      });
      return true;
    }
    return false;
  };

  const toInfo = (row: {
    id: string;
    name: string;
    prefix: string;
    scopes: string;
    role: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
  }): ApiTokenInfo => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: parseScopes(row.scopes),
    role: row.role as UserRole,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });

  // Lista de los tokens propios (sin el valor en claro ni el hash).
  app.get('/', { preHandler: app.authenticate, schema: listTokensSchema }, async (req, reply) => {
    if (rejectApiToken(req, reply)) return;
    const rows = await app.prisma.apiToken.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toInfo);
  });

  // Crear un token. Los scopes se acotan a las capacidades del rol (nunca lo superan).
  app.post<{ Body: CreateApiTokenRequest }>(
    '/',
    { preHandler: app.authenticate, schema: createTokenSchema },
    async (req, reply) => {
      if (rejectApiToken(req, reply)) return;
      const role = req.user.role;
      const scopes = allowedScopesFor(role, req.body.scopes);
      if (scopes.length === 0) {
        return reply.code(400).send({
          code: 'SCOPES_INVALID',
          message: 'Tu rol no permite ninguno de los permisos pedidos.',
        });
      }

      const { token, hash, prefix } = generateApiToken();
      const expiresAt = req.body.expiresInDays
        ? new Date(Date.now() + req.body.expiresInDays * 86_400_000)
        : null;
      const row = await app.prisma.apiToken.create({
        data: {
          userId: req.user.sub,
          name: req.body.name.trim(),
          tokenHash: hash,
          prefix,
          scopes: JSON.stringify(scopes),
          role,
          expiresAt,
        },
      });
      app.audit({ action: 'apitoken.create', userId: req.user.sub, detail: prefix, ip: req.ip });

      const body: CreateApiTokenResponse = { ...toInfo(row), token };
      return reply.code(201).send(body);
    },
  );

  // Revocar un token propio (borrado inmediato).
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: app.authenticate, schema: deleteTokenSchema },
    async (req, reply) => {
      if (rejectApiToken(req, reply)) return;
      // Acotado a los propios: un usuario no puede revocar el token de otro.
      const result = await app.prisma.apiToken.deleteMany({
        where: { id: req.params.id, userId: req.user.sub },
      });
      if (result.count === 0) {
        return reply.code(404).send({ code: 'TOKEN_NOT_FOUND', message: 'Token no encontrado' });
      }
      app.audit({ action: 'apitoken.revoke', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
