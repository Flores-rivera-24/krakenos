import type { User } from '@krakenos/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Valida la sesión persistida al recargar la app. El cliente `api` ya maneja
 * el 401 → refresh → reintento, así que si esto resuelve, la sesión es válida.
 * Si falla (refresh incluido), limpia la sesión.
 *
 * Devuelve `true` si hay sesión válida.
 */
export async function verifySession(): Promise<boolean> {
  if (!useAuthStore.getState().tokens) return false;
  try {
    const user = await api.get<User>('/auth/status');
    // Refresca los datos del usuario por si cambiaron (rol, nombre…).
    useAuthStore.setState({ user });
    return true;
  } catch {
    useAuthStore.setState({ user: null, tokens: null });
    return false;
  }
}
