import type { AuthTokens, LoginResponse, LoginResult, User } from '@krakenos/types';
import { create } from 'zustand';

/**
 * Por qué falló el último `refresh()`. Distinguirlo es el arreglo de AUD3-25:
 *  - `expired`     — el agente contestó 401/403: la cookie ya no vale. Hay que
 *                    volver al login.
 *  - `unreachable` — no se pudo hablar con el agente (fallo de red o 5xx). La
 *                    sesión **sigue siendo válida**; solo no se pudo comprobar.
 */
export type RefreshFailure = 'expired' | 'unreachable';

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  /** Motivo del último `refresh()` fallido; `null` si el último fue bien. */
  lastRefreshFailure: RefreshFailure | null;
  /**
   * Inicia sesión con email + contraseña. Si el usuario tiene passkey, devuelve
   * `{ requiresWebAuthn: true }` sin establecer la sesión (el 2FA se completa
   * aparte); en otro caso establece la sesión y devuelve `{ user, tokens }`.
   */
  /**
   * `keepSignedIn` (US-269) decide si la cookie del refresh sobrevive a cerrar el
   * navegador. Se manda al servidor, que es quien pone (o no) el `maxAge`: la
   * casilla existía desde la primera versión de la pantalla y no viajaba a ningún
   * sitio.
   */
  login: (email: string, password: string, keepSignedIn?: boolean) => Promise<LoginResult>;
  /**
   * Entrar con un código de recuperación, sin la contraseña (US-269). Emite una
   * sesión completa, así que actualiza el store igual que `login`.
   */
  recoverWithCode: (email: string, code: string) => Promise<void>;
  /** Establece la sesión a partir de una respuesta de login (wizard o 2FA WebAuthn). */
  setSession: (data: LoginResponse) => void;
  /** Intenta refrescar el access token. Devuelve `true` si lo consigue. */
  refresh: () => Promise<boolean>;
  logout: () => Promise<void>;
}

/**
 * Error de una petición de autenticación con el status HTTP. `status === 0` indica
 * un fallo de red / servidor inaccesible (la `fetch` rechazó sin respuesta), lo que
 * permite al login distinguir "credenciales incorrectas" (401) de "no se pudo
 * conectar" (US-55).
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Refresco en vuelo (single-flight, US-56): si hay uno en curso, los siguientes
 * `refresh()` reutilizan su promesa en vez de disparar otro POST `/auth/refresh`.
 * Evita que varios 401 simultáneos (api + socket) roten el refresh token dos veces
 * y se invaliden entre sí. Es a nivel de módulo (el store es singleton).
 */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Petición directa con fetch para evitar dependencia circular con `lib/api`.
 * `credentials: 'same-origin'` para enviar/recibir la cookie `httpOnly` del
 * refresh token (US-91); el access token nunca se persiste (solo en memoria).
 */
async function postJson<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      // Solo declara JSON cuando hay cuerpo: `refresh`/`logout` van sin cuerpo (el
      // token viaja en la cookie), y un `Content-Type: application/json` con body
      // vacío hace que Fastify responda 400 — rompía el bootstrap de sesión al
      // recargar (US-91). Detectado por e2e (US-189).
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // `fetch` sólo rechaza ante un fallo de red / servidor inaccesible.
    throw new HttpError(0, `No se pudo conectar con ${path}`);
  }
  if (!res.ok) throw new HttpError(res.status, `Petición ${path} falló: ${res.status}`);
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

/**
 * ¿Este fallo significa de verdad «ya no tienes sesión»? Solo un 401/403 lo
 * significa. Un fallo de red o un 5xx significan «no pude preguntar», que es
 * otra cosa muy distinta — y tratarlos igual es lo que echaba al usuario al
 * login cada vez que el túnel parpadeaba o el agente se reiniciaba (justo lo
 * que hace el propio actualizador de US-190).
 */
export function clasificarFalloDeRefresh(err: unknown): RefreshFailure {
  if (err instanceof HttpError && (err.status === 401 || err.status === 403)) return 'expired';
  return 'unreachable';
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  tokens: null,
  lastRefreshFailure: null,

  login: async (email, password, keepSignedIn = true) => {
    const data = await postJson<LoginResult>('/auth/login', { email, password, keepSignedIn });
    if (!('requiresWebAuthn' in data)) {
      set({ user: data.user, tokens: data.tokens, lastRefreshFailure: null });
    }
    return data;
  },

  recoverWithCode: async (email, code) => {
    const data = await postJson<LoginResponse>('/auth/recover', { email, code });
    set({ user: data.user, tokens: data.tokens, lastRefreshFailure: null });
  },

  setSession: (data) => set({ user: data.user, tokens: data.tokens, lastRefreshFailure: null }),

  refresh: async () => {
    // Si ya hay un refresco en vuelo, reutiliza su promesa (single-flight, US-56).
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        // Sin cuerpo: el refresh token viaja en la cookie httpOnly (US-91).
        const tokens = await postJson<AuthTokens>('/auth/refresh');
        set({ tokens, lastRefreshFailure: null });
        return true;
      } catch (err) {
        const motivo = clasificarFalloDeRefresh(err);
        // US-234 (AUD3-25): SOLO se borra la sesión si el agente dijo que no vale.
        // Antes el `catch` era ciego y un `HttpError(0)` limpiaba el store igual
        // que un 401 → recargar durante un reinicio del agente te devolvía al
        // login con la cookie todavía buena.
        set(motivo === 'expired' ? { user: null, tokens: null, lastRefreshFailure: motivo } : { lastRefreshFailure: motivo });
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },

  logout: async () => {
    // El servidor revoca el refresh de la cookie y la borra.
    await postJson('/auth/logout').catch(() => undefined);
    set({ user: null, tokens: null, lastRefreshFailure: null });
    // Estado por-usuario que no debe sobrevivir al cambio de cuenta (AUD-14).
    const { useFavoritesStore } = await import('./favorites.store');
    useFavoritesStore.getState().reset();
  },
}));
