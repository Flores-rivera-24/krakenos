import type { User } from '@krakenos/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Restaura la sesión al cargar la app (US-91). El access token vive solo en
 * memoria, así que tras una recarga no hay token: se intenta un `refresh()` que
 * usa la cookie `httpOnly` del refresh token. Si lo consigue, se obtiene el
 * usuario con `/auth/status`. Si no hay cookie válida, no hay sesión.
 *
 * Devuelve `true` si hay sesión válida.
 */
export async function bootstrapSession(): Promise<boolean> {
  const refreshed = await useAuthStore.getState().refresh();
  if (!refreshed) return false;
  try {
    const user = await api.get<User>('/auth/status');
    useAuthStore.setState({ user });
    return true;
  } catch {
    useAuthStore.setState({ user: null, tokens: null });
    return false;
  }
}
