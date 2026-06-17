import { createHash, randomUUID } from 'node:crypto';
import type {
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

  /** Firma access + refresh y persiste el hash del refresh token. */
  private async issueTokens(user: DbUser): Promise<AuthTokens> {
    const accessToken = this.app.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role as UserRole,
      type: 'access',
    });

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

    return { accessToken, refreshToken, expiresIn: env.accessTokenTtl };
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
