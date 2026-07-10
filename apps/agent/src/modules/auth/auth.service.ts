import { createHash, randomUUID } from 'node:crypto';
import type {
  AuthSession,
  MfaPendingTokenClaims,
  RefreshTokenClaims,
  UiMode,
  User,
  UserRole,
} from '@krakenos/types';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { mfaTokenStore } from '../../auth/mfa-token-store.js';
import { env } from '../../config/env.js';
import { SETTING_BOUNDS, clampToBound } from '../../config/settings-bounds.js';

/** Validez del token efímero de 2FA pendiente (US-51): 2 minutos. */
const MFA_PENDING_TTL_SEC = 2 * 60;

/**
 * Hash señuelo del MISMO coste (12) que los hashes reales. La comparación
 * anti-enumeración en `verifyCredentials` tarda lo mismo exista o no la cuenta —
 * antes el señuelo era coste 10, un oráculo de temporización para enumerar cuentas.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('krakenos-anti-enumeracion', 12);

/**
 * Tokens emitidos **internamente** (US-91): incluyen el refresh token para que la
 * ruta lo fije en la cookie `httpOnly`. La ruta nunca lo devuelve en el cuerpo —
 * al cliente solo le llega `{ accessToken, expiresIn }` (el `AuthTokens` público).
 */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Sesión emitida internamente: usuario + tokens (con refresh para la cookie). */
export interface IssuedSession {
  user: User;
  tokens: IssuedTokens;
}

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
  status: string;
  lastLoginAt: Date | null;
  expiresAt: Date | null;
  uiMode: string;
  createdAt: Date;
  updatedAt: Date;
}

/** ¿El acceso del usuario caducó? (invitados con `expiresAt`, US-179). */
function isExpired(row: Pick<DbUser, 'expiresAt'>, now: Date = new Date()): boolean {
  return row.expiresAt !== null && row.expiresAt <= now;
}

function toUser(row: DbUser): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as UserRole,
    // Valor legado/desconocido → 'advanced' (comportamiento de siempre).
    uiMode: row.uiMode === 'simple' ? 'simple' : 'advanced',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class AuthService {
  constructor(private readonly app: FastifyInstance) {}

  /**
   * TTL del access token: lee el ajuste `accessTokenTtl` con fallback a `env` y
   * lo **acota** a su rango permitido (US-75, F5) — un valor enorme no puede
   * anular la "vida corta" del access token.
   */
  private async accessTtl(): Promise<number> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: 'accessTokenTtl' } });
    const n = row ? Number(row.value) : env.accessTokenTtl;
    return clampToBound(n, SETTING_BOUNDS.accessTokenTtl) ?? env.accessTokenTtl;
  }

  /** Firma access + refresh y persiste el hash del refresh token. */
  private async issueTokens(user: DbUser): Promise<IssuedTokens> {
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

  /** Revoca todas las sesiones (refresh tokens no revocados) de un usuario. */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.app.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
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

  /** Cambia el modo de la interfaz del propio usuario (autoservicio, US-176). */
  async setUiMode(userId: string, uiMode: UiMode): Promise<User> {
    const row = (await this.app.prisma.user.update({
      where: { id: userId },
      data: { uiMode },
    })) as DbUser;
    return toUser(row);
  }

  /**
   * Verifica email + contraseña sin emitir tokens. Lo usa el login para decidir si
   * exigir 2FA WebAuthn antes de emitir la sesión (US-50). Lanza `AuthError` si
   * las credenciales no son válidas.
   */
  async verifyCredentials(email: string, password: string): Promise<User> {
    const user = (await this.app.prisma.user.findUnique({
      where: { email },
    })) as DbUser | null;

    // Comparación de coste constante incluso si el usuario no existe (anti-enumeración).
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      throw new AuthError('AUTH_INVALID_CREDENTIALS', 'Credenciales inválidas');
    }
    // Cuenta deshabilitada (US-101): se comprueba **después** de validar la
    // contraseña, así un fallo de credenciales no revela si la cuenta existe.
    if (user.status === 'disabled') {
      throw new AuthError('AUTH_ACCOUNT_DISABLED', 'La cuenta está deshabilitada');
    }
    // Acceso caducado (invitados, US-179): mismo tratamiento que deshabilitado.
    if (isExpired(user)) {
      throw new AuthError('AUTH_ACCOUNT_EXPIRED', 'El acceso ha caducado');
    }
    return toUser(user);
  }

  /**
   * Cambia la propia contraseña (US-101): verifica la actual y guarda el nuevo hash.
   * La rotación de sesiones la decide la ruta (revoca las demás, conserva la actual).
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const row = (await this.app.prisma.user.findUnique({ where: { id: userId } })) as DbUser | null;
    if (!row) {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Usuario no encontrado');
    }
    const valid = await bcrypt.compare(currentPassword, row.passwordHash);
    if (!valid) {
      throw new AuthError('AUTH_INVALID_CREDENTIALS', 'La contraseña actual no es correcta');
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.app.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  /**
   * Firma un token efímero `mfa-pending` (US-51): acredita que el usuario superó el
   * primer factor (contraseña) y liga el paso de login con la verificación de passkey.
   * No es un access token (su `type` no es `'access'`), así que `authenticate` lo rechaza.
   * Lleva un `jti` único para poder hacerlo de un solo uso (anti-replay, US-88).
   */
  issueMfaPendingToken(userId: string): string {
    return this.app.jwt.sign(
      { sub: userId, type: 'mfa-pending', jti: randomUUID() },
      { expiresIn: MFA_PENDING_TTL_SEC },
    );
  }

  /**
   * Verifica firma, expiración y `type` de un token `mfa-pending`. Lanza `AuthError`
   * si algo no cuadra. **No** consume el token (lo usa `authenticate/options`, que
   * solo lee opciones y no emite sesión).
   */
  private decodeMfaPendingToken(token: string): MfaPendingTokenClaims {
    let claims: MfaPendingTokenClaims;
    try {
      claims = this.app.verifyToken<MfaPendingTokenClaims>(token);
    } catch {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Token de 2FA inválido o expirado');
    }
    if (claims.type !== 'mfa-pending') {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Tipo de token incorrecto');
    }
    return claims;
  }

  /**
   * Verifica un token `mfa-pending` y devuelve el `sub` (id del usuario). Lanza
   * `AuthError` si la firma es inválida, expiró o el tipo no es `mfa-pending`.
   */
  verifyMfaPendingToken(token: string): string {
    return this.decodeMfaPendingToken(token).sub;
  }

  /**
   * Verifica **y consume** un token `mfa-pending`: lo marca de un solo uso por su
   * `jti`. Lo usan los endpoints que emiten sesión (`authenticate/verify`,
   * `backup-codes/verify`), de modo que un mismo token no permita más de un intento
   * de segundo factor (anti-replay y anti-fuerza-bruta de códigos, US-88). Un
   * segundo uso del mismo token —o uno sin `jti`— lanza `AuthError`.
   */
  consumeMfaPendingToken(token: string): string {
    const claims = this.decodeMfaPendingToken(token);
    const expiresAtMs = (claims.exp ?? 0) * 1000;
    if (!claims.jti || !mfaTokenStore.consume(claims.jti, expiresAtMs)) {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Token de 2FA ya utilizado o inválido');
    }
    return claims.sub;
  }

  /**
   * Emite una sesión (user + tokens) para un usuario ya autenticado por otro medio
   * (contraseña verificada, o passkey WebAuthn tras el 2FA).
   */
  async issueSessionForUserId(userId: string): Promise<IssuedSession> {
    const row = (await this.app.prisma.user.findUnique({ where: { id: userId } })) as DbUser | null;
    if (!row) {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Usuario no encontrado');
    }
    // Revalida el estado aquí (no solo en `login`): este camino también lo usan el
    // setup y ambos verificadores de 2FA. Sin esto, si un admin deshabilita la
    // cuenta durante la ventana del `mfaToken` (120 s), el usuario completaría la
    // passkey/código y obtendría una sesión completa para una cuenta ya bloqueada.
    if (row.status === 'disabled') {
      throw new AuthError('AUTH_ACCOUNT_DISABLED', 'La cuenta está deshabilitada');
    }
    if (isExpired(row)) {
      throw new AuthError('AUTH_ACCOUNT_EXPIRED', 'El acceso ha caducado');
    }
    // Registra el último acceso efectivo (US-101): visible para el admin en la
    // gestión de usuarios. Se marca al emitir sesión (login/2FA/setup), no al refrescar.
    await this.app.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    return { user: toUser(row), tokens: await this.issueTokens(row) };
  }

  async login(email: string, password: string): Promise<IssuedSession> {
    const user = await this.verifyCredentials(email, password);
    return this.issueSessionForUserId(user.id);
  }

  /**
   * Rota el refresh token: revoca el actual (marcándolo como **rotado**) y emite
   * uno nuevo. Detección de reuso (US-78, F4): si llega un token que ya fue rotado,
   * es señal de robo (el legítimo y el atacante comparten el mismo padre) → se
   * revoca **toda la familia** del usuario y se registra un evento de seguridad.
   */
  async refresh(refreshToken: string, ip?: string | null): Promise<IssuedTokens> {
    let claims: RefreshTokenClaims;
    try {
      // `verifyToken` resuelve la clave por `kid` (rotación RS256, US-64): un
      // refresh firmado con la clave previa sigue válido durante el solape.
      claims = this.app.verifyToken<RefreshTokenClaims>(refreshToken);
    } catch {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Refresh token inválido');
    }
    if (claims.type !== 'refresh') {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Tipo de token incorrecto');
    }

    const stored = await this.app.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
    });
    if (!stored) {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Refresh token inválido');
    }

    // Reuso de un token ya ROTADO → posible robo (el padre se presenta tras haber
    // emitido un hijo). Revoca toda la familia del usuario y alerta. Un token
    // revocado por logout/admin (sin `rotatedAt`) no dispara esto: rechazo simple.
    if (stored.revoked) {
      if (stored.rotatedAt) {
        const revoked = await this.revokeAllForUser(stored.userId);
        this.app.audit({
          action: 'auth.refresh_reuse',
          userId: stored.userId,
          detail: `sesiones revocadas: ${revoked}`,
          ip,
        });
        throw new AuthError('AUTH_REFRESH_REUSE', 'Refresh token reutilizado; sesiones revocadas');
      }
      throw new AuthError('AUTH_INVALID_TOKEN', 'Refresh token revocado o expirado');
    }
    if (stored.expiresAt < new Date()) {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Refresh token revocado o expirado');
    }

    const user = (await this.app.prisma.user.findUnique({
      where: { id: claims.sub },
    })) as DbUser | null;
    if (!user) {
      throw new AuthError('AUTH_INVALID_TOKEN', 'Usuario no encontrado');
    }
    // Cuenta deshabilitada tras emitir la sesión (US-101): corta el refresco y
    // revoca lo que quede, de modo que una sesión viva no sobreviva al bloqueo.
    if (user.status === 'disabled') {
      await this.revokeAllForUser(user.id);
      throw new AuthError('AUTH_ACCOUNT_DISABLED', 'La cuenta está deshabilitada');
    }
    // Un invitado caducado tampoco refresca: caduca de verdad, sin sesión viva (US-179).
    if (isExpired(user)) {
      await this.revokeAllForUser(user.id);
      throw new AuthError('AUTH_ACCOUNT_EXPIRED', 'El acceso ha caducado');
    }

    // Revocación ATÓMICA y condicional (cierra el TOCTOU): solo un `refresh`
    // concurrente puede pasar `revoked:false → true`. Si dos peticiones llegan a la
    // vez con el mismo token robado+legítimo, una gana (count===1) y la otra ve
    // count===0 → la tratamos como reuso (rota dos veces el mismo padre) y revocamos
    // la familia + alertamos, en vez de emitir dos sesiones vivas en paralelo sin
    // que salte la detección de reuso de US-78.
    const claimed = await this.app.prisma.refreshToken.updateMany({
      where: { id: stored.id, revoked: false },
      data: { revoked: true, rotatedAt: new Date() },
    });
    if (claimed.count !== 1) {
      const revoked = await this.revokeAllForUser(stored.userId);
      this.app.audit({
        action: 'auth.refresh_reuse',
        userId: stored.userId,
        detail: `rotación concurrente; sesiones revocadas: ${revoked}`,
        ip,
      });
      throw new AuthError('AUTH_REFRESH_REUSE', 'Refresh token reutilizado; sesiones revocadas');
    }

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
