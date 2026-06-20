import type { Id, IsoDateTime } from './common.js';

/** Roles soportados por KrakenOS. */
export type UserRole = 'admin' | 'viewer';

/** Usuario tal como se expone al cliente (sin hash de contraseña). */
export interface User {
  id: Id;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
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

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

/** Respuesta de login y de refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
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

/** Cuerpo opcional de `DELETE /api/auth/sessions` (cerrar todas menos la actual). */
export interface RevokeSessionsRequest {
  /** Refresh token de la sesión a conservar (no se revoca). */
  keepRefreshToken?: string;
}
