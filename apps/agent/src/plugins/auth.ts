import fastifyJwt from '@fastify/jwt';
import type { AccessTokenClaims, RefreshTokenClaims, UserRole } from '@krakenos/types';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

/** Cargas firmables: `iat`/`exp` los añade la librería al firmar. */
type SignablePayload =
  | Omit<AccessTokenClaims, 'iat' | 'exp'>
  | Omit<RefreshTokenClaims, 'iat' | 'exp'>;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SignablePayload;
    user: AccessTokenClaims;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler: exige un access token válido. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Genera un preHandler que además exige un rol concreto. */
    requireRole: (
      role: UserRole,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Configura @fastify/jwt con RS256 (clave privada para firmar, pública para
 * verificar) y registra los preHandlers de autorización.
 */
/** Emisor/audiencia de los JWT: acota dónde son válidos los tokens de KrakenOS. */
const JWT_ISSUER = 'krakenos';
const JWT_AUDIENCE = 'krakenos';

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(fastifyJwt, {
    secret: {
      private: env.jwtPrivateKey,
      public: env.jwtPublicKey,
    },
    sign: {
      algorithm: 'RS256',
      expiresIn: env.accessTokenTtl,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
    },
    verify: { algorithms: ['RS256'], allowedIss: JWT_ISSUER, allowedAud: JWT_AUDIENCE },
  });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      if (req.user.type !== 'access') {
        return reply.code(401).send({
          code: 'AUTH_INVALID_TOKEN',
          message: 'Se requiere un access token',
        });
      }
    } catch {
      return reply.code(401).send({
        code: 'AUTH_UNAUTHORIZED',
        message: 'Token ausente o inválido',
      });
    }
  });

  app.decorate('requireRole', (role: UserRole) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(req, reply);
      if (reply.sent) return;
      if (req.user.role !== role) {
        return reply.code(403).send({
          code: 'AUTH_FORBIDDEN',
          message: `Requiere rol ${role}`,
        });
      }
    };
  });
});
