import type { AuthTokens, LoginResponse, LoginResult, User } from '@krakenos/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

/** Petición directa con fetch para evitar dependencia circular con `lib/api`. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // `fetch` sólo rechaza ante un fallo de red / servidor inaccesible.
    throw new HttpError(0, `No se pudo conectar con ${path}`);
  }
  if (!res.ok) throw new HttpError(res.status, `Petición ${path} falló: ${res.status}`);
  return res.json() as Promise<T>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
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
        const current = get().tokens?.refreshToken;
        if (!current) return false;
        refreshInFlight = (async () => {
          try {
            const tokens = await postJson<AuthTokens>('/auth/refresh', { refreshToken: current });
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
        const current = get().tokens?.refreshToken;
        if (current) {
          await postJson('/auth/logout', { refreshToken: current }).catch(() => undefined);
        }
        set({ user: null, tokens: null });
      },
    }),
    { name: 'krakenos-auth' },
  ),
);
