import type { AuthTokens, LoginResponse, User } from '@krakenos/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  login: (email: string, password: string) => Promise<void>;
  /** Establece la sesión a partir de una respuesta de login (p. ej. tras el wizard). */
  setSession: (data: LoginResponse) => void;
  /** Intenta refrescar el access token. Devuelve `true` si lo consigue. */
  refresh: () => Promise<boolean>;
  logout: () => Promise<void>;
}

/** Petición directa con fetch para evitar dependencia circular con `lib/api`. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Petición ${path} falló: ${res.status}`);
  return res.json() as Promise<T>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tokens: null,

      login: async (email, password) => {
        const data = await postJson<LoginResponse>('/auth/login', { email, password });
        set({ user: data.user, tokens: data.tokens });
      },

      setSession: (data) => set({ user: data.user, tokens: data.tokens }),

      refresh: async () => {
        const current = get().tokens?.refreshToken;
        if (!current) return false;
        try {
          const tokens = await postJson<AuthTokens>('/auth/refresh', { refreshToken: current });
          set({ tokens });
          return true;
        } catch {
          set({ user: null, tokens: null });
          return false;
        }
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
