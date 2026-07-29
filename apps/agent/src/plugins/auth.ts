import fastifyJwt from '@fastify/jwt';
import type {
  AccessTokenClaims,
  ApiTokenScope,
  MfaPendingTokenClaims,
  RefreshTokenClaims,
  StreamTokenClaims,
  UserRole,
} from '@krakenos/types';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hashApiToken, isApiTokenValue, parseScopes } from '../auth/api-token.js';
import { type Capability, can } from '../auth/capabilities.js';
import { Keyring } from '../auth/keyring.js';
import { env } from '../config/env.js';

/** Cargas firmables: `iat`/`exp` los añade la librería al firmar. */
type SignablePayload =
  | Omit<AccessTokenClaims, 'iat' | 'exp'>
  | Omit<RefreshTokenClaims, 'iat' | 'exp'>
  | Omit<MfaPendingTokenClaims, 'iat' | 'exp'>
  | Omit<StreamTokenClaims, 'iat' | 'exp'>;

/** Claims de cualquiera de los tokens que emite el agente. */
type AnyTokenClaims =
  | AccessTokenClaims
  | RefreshTokenClaims
  | MfaPendingTokenClaims
  | StreamTokenClaims;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SignablePayload;
    user: AccessTokenClaims;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Scopes del token de API (US-174) si la petición se autenticó con uno; queda
     * `undefined` en las sesiones normales. Su presencia marca la petición como
     * "de token": las rutas de administración (`requireRole`/`requireActiveAdmin`)
     * la rechazan y `requireCapability` la acota a estos scopes.
     */
    apiScopes?: ApiTokenScope[];
  }
  interface FastifyInstance {
    /** preHandler: exige un access token válido. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Genera un preHandler que además exige un rol concreto. */
    requireRole: (
      role: UserRole,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Genera un preHandler que exige una **capacidad** (US-179): generaliza
     * `requireRole` para los roles del hogar sin tocar las rutas admin (mapa en
     * `auth/capabilities.ts`).
     */
    requireCapability: (
      capability: Capability,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * preHandler que exige **admin activo re-verificado en la DB** (no solo el claim
     * del token). Cierra la ventana en la que un admin recién degradado/deshabilitado
     * podría —con su access token aún válido— reganar privilegios o exfiltrar/borrar
     * (gestión de usuarios, backup, restore). Para el resto de rutas admin basta
     * `requireRole` (el residual queda acotado por la vida corta del access token).
     */
    requireActiveAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
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

  const unauthorized = (reply: FastifyReply) =>
    reply.code(401).send({ code: 'AUTH_UNAUTHORIZED', message: 'Token ausente o inválido' });

  /**
   * Autentica una petición con un **token de API** (US-174): opaco, resuelto por
   * su hash en la DB. Popula `req.user` (con el rol ACTUAL del emisor, no el de la
   * foto: si su rol bajó, sus capacidades bajan) y `req.apiScopes` (re-intersectado
   * con el rol actual). Un token expirado o de un usuario inactivo → 401.
   */
  const authenticateApiToken = async (req: FastifyRequest, reply: FastifyReply, raw: string) => {
    const row = await app.prisma.apiToken.findUnique({ where: { tokenHash: hashApiToken(raw) } });
    if (!row) return unauthorized(reply);
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return unauthorized(reply);
    const owner = await app.prisma.user.findUnique({
      where: { id: row.userId },
      select: { email: true, role: true, status: true, expiresAt: true },
    });
    if (!owner || owner.status !== 'active') return unauthorized(reply);
    // La caducidad del **usuario** (invitado, US-179) también corta el token: sin
    // esto, un `guest` se creaba un token sin caducidad durante su estancia y
    // conservaba acceso indefinido cuando su cuenta ya no servía para entrar
    // (login/refresh/2FA sí lo comprobaban; el token de API no) — AUD3-04.
    if (owner.expiresAt && owner.expiresAt.getTime() < Date.now()) return unauthorized(reply);
    const role = owner.role as UserRole;
    req.user = { sub: row.userId, email: owner.email, role, type: 'access', iat: 0, exp: 0 };
    // Los scopes guardados se re-acotan al rol vigente (nunca lo superan).
    req.apiScopes = parseScopes(row.scopes).filter((s) => can(role, s as Capability));
    // Marca de último uso, best-effort (no bloquea ni rompe la petición).
    void app.prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  };

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    let raw: string;
    try {
      raw = app.jwt.lookupToken(req);
    } catch {
      return unauthorized(reply);
    }

    // Token de API (US-174): opaco, no es un JWT — se resuelve por hash en la DB.
    if (isApiTokenValue(raw)) {
      return authenticateApiToken(req, reply, raw);
    }

    // JWT de sesión.
    let claims: AccessTokenClaims;
    try {
      // Verifica con la clave que indique el `kid` (incluye la previa durante el
      // solape de una rotación). Popula `req.user` como jwtVerify.
      claims = app.verifyToken<AccessTokenClaims>(raw);
      req.user = claims;
    } catch {
      return unauthorized(reply);
    }
    if (claims.type !== 'access') {
      return reply.code(401).send({
        code: 'AUTH_INVALID_TOKEN',
        message: 'Se requiere un access token',
      });
    }
  });

  /** 403 para un token de API en una ruta de administración (US-174). */
  const apiTokenForbidden = (reply: FastifyReply) =>
    reply.code(403).send({
      code: 'API_TOKEN_FORBIDDEN',
      message: 'Los tokens de API no pueden administrar; usa una sesión.',
    });

  app.decorate('requireRole', (role: UserRole) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(req, reply);
      if (reply.sent) return;
      // Un token de API NUNCA administra, aunque su emisor sea admin (US-174).
      if (req.apiScopes) return apiTokenForbidden(reply);
      if (req.user.role !== role) {
        return reply.code(403).send({
          code: 'AUTH_FORBIDDEN',
          message: `Requiere rol ${role}`,
        });
      }
    };
  });

  app.decorate('requireCapability', (capability: Capability) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(req, reply);
      if (reply.sent) return;
      // Con token de API, la capacidad debe estar entre sus scopes (ya acotados al
      // rol vigente). Con sesión, basta la capacidad del rol.
      const allowed = req.apiScopes
        ? req.apiScopes.includes(capability as ApiTokenScope)
        : can(req.user.role, capability);
      if (!allowed) {
        return reply.code(403).send({
          code: 'AUTH_FORBIDDEN',
          message: 'Tu rol no permite esta acción',
        });
      }
    };
  });

  // Re-verifica admin+activo contra la DB (no solo el claim del token): cierra la
  // ventana en que un admin recién degradado/deshabilitado, con su access token aún
  // válido, reganaría privilegios o exfiltraría/borraría (gestión de usuarios/backup/
  // restore). Coste: una lectura por petición en esas rutas sensibles.
  app.decorate('requireActiveAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply);
    if (reply.sent) return;
    // Un token de API nunca opera gestión sensible (backup/restore/usuarios), US-174.
    if (req.apiScopes) return apiTokenForbidden(reply);
    const actor = await app.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { role: true, status: true },
    });
    if (!actor || actor.role !== 'admin' || actor.status !== 'active') {
      return reply.code(403).send({
        code: 'AUTH_FORBIDDEN',
        message: 'Requiere un administrador activo',
      });
    }
  });
});
