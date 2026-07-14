import { createHash, randomBytes } from 'node:crypto';
import { API_TOKEN_PREFIX, API_TOKEN_SCOPES, type ApiTokenScope } from '@krakenos/types';
import { type Capability, can } from './capabilities.js';
import type { UserRole } from '@krakenos/types';

/**
 * Tokens personales de API (US-174) — helpers **puros**. El token es opaco
 * (`krt_<aleatorio>`), se guarda **solo por su hash sha256** (como los refresh) y
 * se muestra en claro una única vez. Los scopes derivan de las capacidades del rol
 * del emisor y **nunca lo superan**.
 */

/** Genera un token nuevo: valor en claro + su hash + su prefijo visible. */
export function generateApiToken(): { token: string; hash: string; prefix: string } {
  // 32 bytes → 43 chars base64url; sin padding ni caracteres ambiguos de URL.
  const secret = randomBytes(32).toString('base64url');
  const token = `${API_TOKEN_PREFIX}${secret}`;
  return { token, hash: hashApiToken(token), prefix: token.slice(0, API_TOKEN_PREFIX.length + 4) };
}

/** Hash sha256 (hex) de un token — lo que se persiste y con lo que se busca. */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** ¿Tiene el valor la forma de un token de API (`krt_…`)? */
export function isApiTokenValue(value: string): boolean {
  return value.startsWith(API_TOKEN_PREFIX);
}

/** Parseo defensivo de los scopes guardados (JSON string) → solo los válidos. */
export function parseScopes(raw: string): ApiTokenScope[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is ApiTokenScope =>
      (API_TOKEN_SCOPES as readonly string[]).includes(s as string),
    );
  } catch {
    return [];
  }
}

/**
 * Acota los scopes pedidos a los **permitidos por el rol** del emisor (un token
 * nunca supera su rol). Devuelve el subconjunto válido, deduplicado y en orden
 * canónico. Vacío si no queda ninguno (el llamante rechaza con 400).
 */
export function allowedScopesFor(role: UserRole, requested: ApiTokenScope[]): ApiTokenScope[] {
  const req = new Set(requested);
  return API_TOKEN_SCOPES.filter((s) => req.has(s) && can(role, s as Capability));
}
