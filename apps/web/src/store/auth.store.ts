import type { AuthTokens, LoginResponse, LoginResult, User } from '@krakenos/types';
import { create } from 'zustand';

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  /**
   * Inicia sesión con email + contraseña. Si el usuario tiene passkey, devuelve
   * `{ requiresWebAuthn: true }` sin establecer la sesión (el 2FA se completa
   * aparte); en otro caso establece la sesión y devuelve `{ user, tokens }`.
   */
  login: (email: string, password: string) => Promise<LoginResult>;
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
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // `fetch` sólo rechaza ante un fallo de red / servidor inaccesible.
    throw new HttpError(0, `No se pudo conectar con ${path}`);
  }
  if (!res.ok) throw new HttpError(res.status, `Petición ${path} falló: ${res.status}`);
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  tokens: null,

  login: async (email, password) => {
    const data = await postJson<LoginResult>('/auth/login', { email, password });
    if (!('requiresWebAuthn' in data)) {
      set({ user: data.user, tokens: data.tokens });
    }
    return data;
  },

  setSession: (data) => set({ user: data.user, tokens: data.tokens }),

  refresh: async () => {
    // Si ya hay un refresco en vuelo, reutiliza su promesa (single-flight, US-56).
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        // Sin cuerpo: el refresh token viaja en la cookie httpOnly (US-91).
        const tokens = await postJson<AuthTokens>('/auth/refresh');
        set({ tokens });
        return true;
      } catch {
        set({ user: null, tokens: null });
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
    set({ user: null, tokens: null });
  },
}));
