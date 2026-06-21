import fastifyJwt from '@fastify/jwt';
import type {
  AccessTokenClaims,
  MfaPendingTokenClaims,
  RefreshTokenClaims,
  UserRole,
} from '@krakenos/types';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Keyring } from '../auth/keyring.js';
import { env } from '../config/env.js';

/** Cargas firmables: `iat`/`exp` los añade la librería al firmar. */
type SignablePayload =
  | Omit<AccessTokenClaims, 'iat' | 'exp'>
  | Omit<RefreshTokenClaims, 'iat' | 'exp'>
  | Omit<MfaPendingTokenClaims, 'iat' | 'exp'>;

/** Claims de cualquiera de los tokens que emite el agente. */
type AnyTokenClaims = AccessTokenClaims | RefreshTokenClaims | MfaPendingTokenClaims;

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
    /**
     * Verifica un JWT eligiendo la clave por `kid` (rotación RS256, US-64): la
     * clave de firma actual o una previa durante el solape. Lanza si la firma,
     * el emisor/audiencia o la expiración no validan, o si el `kid` es desconocido.
     */
    verifyToken: <T extends AnyTokenClaims = AccessTokenClaims>(token: string) => T;
  }
}

/** Emisor/audiencia de los JWT: acota dónde son válidos los tokens de KrakenOS. */
const JWT_ISSUER = 'krakenos';
const JWT_AUDIENCE = 'krakenos';

/** Lee el `kid` de la cabecera de un JWT sin verificar la firma (`undefined` si no hay). */
function readKid(token: string): string | undefined {
  const headerSegment = token.split('.')[0];
  if (!headerSegment) return undefined;
  try {
    const json = Buffer.from(headerSegment, 'base64url').toString('utf8');
    const header = JSON.parse(json) as { kid?: unknown };
    return typeof header.kid === 'string' ? header.kid : undefined;
  } catch {
    return undefined;
  }
}

/** Opciones del plugin: permite inyectar un llavero (útil en tests de rotación). */
export interface AuthPluginOptions {
  keyring?: Keyring;
}

export const authPlugin = fp(async (app: FastifyInstance, opts: AuthPluginOptions) => {
  // Llavero RS256 con rotación (US-64): firma con la clave actual e incluye su
  // `kid` en la cabecera; durante el solape de una rotación, las claves públicas
  // previas siguen verificando los tokens aún válidos que firmó la clave anterior.
  const keyring =
    opts.keyring ??
    new Keyring(
      { privateKey: env.jwtPrivateKey, publicKey: env.jwtPublicKey },
      env.jwtPreviousPublicKeys,
    );

  await app.register(fastifyJwt, {
    secret: { private: keyring.signingPrivateKey(), public: keyring.signingPublicKey() },
    sign: {
      algorithm: 'RS256',
      expiresIn: env.accessTokenTtl,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      // El `kid` de la clave de firma actual viaja en la cabecera de cada token.
      kid: keyring.signingKid,
    },
    verify: { algorithms: ['RS256'], allowedIss: JWT_ISSUER, allowedAud: JWT_AUDIENCE },
  });

  app.decorate('verifyToken', <T extends AnyTokenClaims = AccessTokenClaims>(token: string): T => {
    const kid = readKid(token);
    // Sin `kid` (token previo a la rotación) o con el `kid` actual → clave por
    // defecto del plugin (síncrono). Con un `kid` previo → su clave pública.
    if (!kid || kid === keyring.signingKid) {
      return app.jwt.verify<T>(token);
    }
    const key = keyring.publicKeyForKid(kid);
    if (!key) {
      throw new Error('JWT firmado con una clave desconocida (kid)');
    }
    return app.jwt.verify<T>(token, {
      key,
      algorithms: ['RS256'],
      allowedIss: JWT_ISSUER,
      allowedAud: JWT_AUDIENCE,
    });
  });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    let claims: AccessTokenClaims;
    try {
      // Extrae el Bearer y verifica con la clave que indique el `kid` (incluye la
      // previa durante el solape de una rotación). Popula `req.user` como jwtVerify.
      claims = app.verifyToken<AccessTokenClaims>(app.jwt.lookupToken(req));
      req.user = claims;
    } catch {
      return reply.code(401).send({
        code: 'AUTH_UNAUTHORIZED',
        message: 'Token ausente o inválido',
      });
    }
    if (claims.type !== 'access') {
      return reply.code(401).send({
        code: 'AUTH_INVALID_TOKEN',
        message: 'Se requiere un access token',
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
