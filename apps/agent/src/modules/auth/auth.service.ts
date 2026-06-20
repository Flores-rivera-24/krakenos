import { createHash, randomUUID } from 'node:crypto';
import type {
  AuthSession,
  AuthTokens,
  LoginResponse,
  RefreshTokenClaims,
  User,
  UserRole,
} from '@krakenos/types';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

/** Error de dominio de autenticación con código estable. */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Hash determinista para almacenar/buscar refresh tokens sin guardarlos en claro. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface DbUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

function toUser(row: DbUser): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as UserRole,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class AuthService {
  constructor(private readonly app: FastifyInstance) {}

  /** TTL del access token: lee el ajuste `accessTokenTtl` con fallback a `env`. */
  private async accessTtl(): Promise<number> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: 'accessTokenTtl' } });
    const n = row ? Number(row.value) : NaN;
    return Number.isFinite(n) && n > 0 ? n : env.accessTokenTtl;
  }

  /** Firma access + refresh y persiste el hash del refresh token. */
  private async issueTokens(user: DbUser): Promise<AuthTokens> {
    const accessTtl = await this.accessTtl();
    const accessToken = this.app.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role as UserRole,
        type: 'access',
      },
      { expiresIn: accessTtl },
    );

    const jti = randomUUID();
    const refreshClaims: Pick<RefreshTokenClaims, 'sub' | 'type' | 'jti'> = {
      sub: user.id,
      type: 'refresh',
      jti,
    };
    const refreshToken = this.app.jwt.sign(refreshClaims, {
      expiresIn: env.refreshTokenTtl,
    });

    await this.app.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + env.refreshTokenTtl * 1000),
      },
    });

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  /** Lista las sesiones activas (refresh tokens no revocados ni expirados) de un usuario. */
  async listSessions(userId: string): Promise<AuthSession[]> {
    const rows = await this.app.prisma.refreshToken.findMany({
      where: { userId, revoked: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  /**
   * Revoca una sesión por id. Un no-admin solo puede revocar las suyas.
   * Devuelve `false` si no existe o no pertenece al usuario (sin ser admin).
   */
  async revokeSession(id: string, requesterId: string, isAdmin: boolean): Promise<boolean> {
    const row = await this.app.prisma.refreshToken.findUnique({ where: { id } });
    if (!row || (!isAdmin && row.userId !== requesterId)) return false;
    await this.app.prisma.refreshToken.update({ where: { id }, data: { revoked: true } });
    return true;
  }

  /** Revoca todas las sesiones del usuario excepto la del `keepRefreshToken` (si se da). */
  async revokeOtherSessions(userId: string, keepRefreshToken?: string): Promise<number> {
    const keepHash = keepRefreshToken ? hashToken(keepRefreshToken) : undefined;
    const result = await this.app.prisma.refreshToken.updateMany({
      where: {
        userId,
        revoked: false,
        ...(keepHash ? { tokenHash: { not: keepHash } } : {}),
      },
      data: { revoked: true },
    });
    return result.count;
  }

  /** Revoca **todas** las sesiones (todos los usuarios) — p. ej. tras regenerar claves. */
  async revokeAllSessions(): Promise<number> {
    const result = await this.app.prisma.refreshToken.updateMany({
      where: { revoked: false },
      data: { revoked: true },
    });
    return result.count;
  }

  /** Devuelve el usuario actual por id (para verificar la sesión). */
  async getById(id: string): Promise<User | null> {
    const row = (await this.app.prisma.user.findUnique({ where: { id } })) as DbUser | null;
    return row ? toUser(row) : null;
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = (await this.app.prisma.user.findUnique({
      where: { email },
    })) as DbUser | null;

    // Comparación constante incluso si el usuario no existe (anti-enumeración).
    const hash = user?.passwordHash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinv';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      throw new AuthError('AUTH_INVALID_CREDENTIALS', 'Credenciales inválidas');
    }

    return { user: toUser(user), tokens: await this.issueTokens(user) };
  }

  /** Rota el refresh token: revoca el actual y emite uno nuevo. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    let claims: RefreshTokenClaims;
    try {
      claims = this.app.jwt.verify<RefreshTokenClaims>(refreshToken);
    } catch {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Refresh token inválido');
    }
    if (claims.type !== 'refresh') {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Tipo de token incorrecto');
    }

    const stored = await this.app.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
    });
    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Refresh token revocado o expirado');
    }

    const user = (await this.app.prisma.user.findUnique({
      where: { id: claims.sub },
    })) as DbUser | null;
    if (!user) {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Usuario no encontrado');
    }

    await this.app.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });

    return this.issueTokens(user);
  }

  /** Revoca un refresh token (logout). Idempotente. */
  async logout(refreshToken: string): Promise<void> {
    await this.app.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken) },
      data: { revoked: true },
    });
  }
}
