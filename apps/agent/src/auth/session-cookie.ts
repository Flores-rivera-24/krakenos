import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IssuedSession } from '../modules/auth/auth.service.js';
import { env } from '../config/env.js';

/**
 * Cookie del refresh token (US-91, F13).
 *
 * El refresh token (larga vida, rotatorio) viaja en una cookie `httpOnly` —
 * **ilegible por JavaScript**— en vez del cuerpo de la respuesta + `localStorage`.
 * Así un XSS no puede robarlo ni montar una toma de cuenta persistente; el access
 * token (vida corta) sigue en el cuerpo y vive solo en memoria del cliente.
 *
 * Atributos:
 * - `httpOnly`: fuera del alcance de JS (el objetivo de la historia).
 * - `sameSite: 'strict'`: la app es del mismo origen (VPN/LAN), así que la cookie
 *   nunca se envía en peticiones cross-site → cierra el CSRF sobre `refresh`/`logout`
 *   (las demás rutas usan `Authorization: Bearer`, no la cookie).
 * - `secure`: solo sobre HTTPS (TLS nativo o terminado en un proxy de confianza);
 *   en dev (HTTP) se desactiva para que la cookie funcione.
 * - `path: /api/auth`: solo se envía a las rutas de auth, no en cada llamada a la API.
 * - `maxAge`: la vida del refresh token (rotatorio) — **solo si el usuario marcó
 *   «Mantener sesión iniciada»** (US-266). Sin marcar se omite, y entonces es una
 *   *cookie de sesión*: el navegador la borra al cerrarse. El refresh token sigue
 *   teniendo su propia expiración en la base; esto solo decide cuánto dura su
 *   transporte en el cliente.
 */
export const REFRESH_COOKIE = 'krakenos_rt';
const REFRESH_COOKIE_PATH = '/api/auth';

function cookieOptions(persistent: boolean): {
  httpOnly: true;
  sameSite: 'strict';
  secure: boolean;
  path: string;
  maxAge?: number;
} {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.https !== null || env.behindProxy,
    path: REFRESH_COOKIE_PATH,
    // Omitir `maxAge` (no ponerlo a 0, que borraría la cookie) es lo que la
    // convierte en cookie de sesión.
    ...(persistent ? { maxAge: env.refreshTokenTtl } : {}),
  };
}

/**
 * Fija la cookie del refresh token en la respuesta. `persistent` refleja la
 * elección del usuario en «Mantener sesión iniciada» y se propaga desde la fila
 * de `RefreshToken`, de modo que sobreviva a cada rotación.
 */
export function setRefreshCookie(reply: FastifyReply, token: string, persistent: boolean): void {
  reply.setCookie(REFRESH_COOKIE, token, cookieOptions(persistent));
}

/** Borra la cookie del refresh token (logout). */
export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

/** Lee el refresh token de la cookie, o `null` si no está presente. */
export function readRefreshCookie(req: FastifyRequest): string | null {
  return req.cookies[REFRESH_COOKIE] ?? null;
}

/**
 * Emite una sesión al cliente: fija el refresh token en la cookie `httpOnly` y
 * devuelve en el cuerpo solo `{ user, tokens: { accessToken, expiresIn } }` (US-91).
 * Lo usan todos los emisores de sesión: login, setup/init, webauthn y backup-codes.
 */
export function sendSession(reply: FastifyReply, session: IssuedSession): FastifyReply {
  setRefreshCookie(reply, session.tokens.refreshToken, session.tokens.persistent);
  return reply.send({
    user: session.user,
    tokens: { accessToken: session.tokens.accessToken, expiresIn: session.tokens.expiresIn },
  });
}
