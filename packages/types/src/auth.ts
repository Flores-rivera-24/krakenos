import type { Id, IsoDateTime } from './common.js';

/**
 * Roles soportados por KrakenOS (US-179). Array `as const` como fuente única —
 * los schemas JSON derivan de aquí (evita la deriva enum-duplicado, AUD-17):
 * - `admin`: gestiona todo.
 * - `member`: ve el hogar y controla lo cotidiano (IoT, escenas, habitaciones).
 * - `kid`: UI reducida; su acceso lo rigen los horarios/parental (US-108).
 * - `guest`: temporal y acotado; **expira** (`expiresAt`).
 * - `viewer`: solo lectura (rol legado, sigue siendo el default seguro).
 */
export const USER_ROLES = ['admin', 'member', 'kid', 'guest', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Modo de la interfaz por usuario (US-176) — **solo presentación**, la authz
 * del servidor no cambia: `simple` oculta la sección «Red avanzada» y las
 * columnas técnicas (MAC, driver); `advanced` = todo. Array `as const` como
 * fuente única (los schemas derivan).
 */
export const UI_MODES = ['simple', 'advanced'] as const;
export type UiMode = (typeof UI_MODES)[number];

/** Usuario tal como se expone al cliente (sin hash de contraseña). */
export interface User {
  id: Id;
  email: string;
  displayName: string;
  role: UserRole;
  /**
   * Modo de la interfaz (US-176). Opcional por compatibilidad con sesiones
   * antiguas en el cliente; el servidor siempre lo envía. Ausente = `advanced`.
   */
  uiMode?: UiMode;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Cuerpo de `PATCH /api/auth/ui-mode` (autoservicio, US-176). */
export interface UpdateUiModeRequest {
  uiMode: UiMode;
}

/** Estado de la cuenta de un usuario (US-101). Un usuario `disabled` no puede iniciar sesión. */
export type UserStatus = 'active' | 'disabled';

/**
 * Usuario tal como lo ve la gestión de usuarios (US-101): añade estado y último
 * acceso. Nunca incluye el hash de contraseña.
 */
export interface UserSummary {
  id: Id;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: IsoDateTime | null;
  /** Caducidad del acceso (invitados, US-179); `null` = sin caducidad. */
  expiresAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** Alta de un usuario por un admin (US-101). */
export interface CreateUserRequest {
  email: string;
  displayName: string;
  password: string;
  role: UserRole;
  /** Caducidad del acceso (pensado para `guest`, US-179). */
  expiresAt?: IsoDateTime;
}

/** Edición de un usuario por un admin: nombre, rol y/o estado (US-101). */
export interface UpdateUserRequest {
  displayName?: string;
  role?: UserRole;
  status?: UserStatus;
  /** Caducidad del acceso (US-179); `null` la quita. */
  expiresAt?: IsoDateTime | null;
}

/** Un admin fija una nueva contraseña para un usuario (US-101). */
export interface AdminResetPasswordRequest {
  password: string;
}

/** Cambio de la propia contraseña por el usuario autenticado (US-101). */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Claims del access token JWT (RS256). */
export interface AccessTokenClaims {
  /** Subject: id del usuario. */
  sub: Id;
  email: string;
  role: UserRole;
  /** Tipo de token para distinguir access de refresh. */
  type: 'access';
  iat: number;
  exp: number;
}

/** Claims del refresh token JWT (RS256). */
export interface RefreshTokenClaims {
  sub: Id;
  type: 'refresh';
  /** Identificador del refresh token para permitir revocación/rotación. */
  jti: Id;
  iat: number;
  exp: number;
}

/**
 * Claims del token efímero de 2FA pendiente (US-51). Prueba que el primer factor
 * (contraseña) ya se superó y liga el paso de login con el de verificación de
 * passkey. Vive ~2 min y **no** sirve como access token (`authenticate` lo rechaza
 * porque su `type` no es `'access'`).
 */
export interface MfaPendingTokenClaims {
  sub: Id;
  type: 'mfa-pending';
  /**
   * Identificador único del token. Permite hacerlo **de un solo uso**
   * (anti-replay dentro de su ventana de validez): al completar el 2FA el `jti`
   * se marca como consumido y un segundo intento con el mismo token se rechaza.
   */
  jti: Id;
  iat: number;
  exp: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Tokens de sesión devueltos al cliente. El **refresh token ya no viaja en el
 * cuerpo** (US-91, F13): el servidor lo emite en una cookie `httpOnly`+`SameSite`
 * (ilegible por JS), y el access token vive solo en memoria del cliente. Así un
 * XSS no puede robar el refresh (de larga vida) ni montar una toma de cuenta
 * persistente. `POST /auth/refresh` y `/auth/logout` leen la cookie, no el cuerpo.
 */
export interface AuthTokens {
  accessToken: string;
  /** Segundos hasta la expiración del access token. */
  expiresIn: number;
}

export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}

/**
 * Respuesta de `POST /api/auth/login` cuando el usuario tiene passkeys: aún no se
 * emiten tokens; el cliente debe completar el 2FA WebAuthn (US-50).
 */
export interface WebAuthnRequiredResponse {
  requiresWebAuthn: true;
  email: string;
  /**
   * Token efímero que acredita el primer factor (contraseña) ya superado (US-51).
   * El cliente lo reenvía en `authenticate/options` y `authenticate/verify`.
   */
  mfaToken: string;
}

/** Resultado del login: o sesión emitida, o requerimiento de 2FA WebAuthn. */
export type LoginResult = LoginResponse | WebAuthnRequiredResponse;

/**
 * Última sesión registrada, para la pantalla de login (US-49).
 * Endpoint público `GET /api/auth/last-session`; nunca expone email ni userId.
 */
export interface LastSession {
  timestamp: IsoDateTime;
  ip: string;
}

/** Sesión activa (refresh token no revocado ni expirado) mostrada en Ajustes. */
export interface AuthSession {
  id: string;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

/**
 * `DELETE /api/auth/sessions` cierra todas las sesiones **menos la actual**. La
 * sesión a conservar se identifica por la **cookie de refresh** (US-91), no por
 * el cuerpo: el cliente ya no conoce el refresh token.
 */
