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
