import type { User } from '@krakenos/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/** Esperas entre reintentos del bootstrap, en ms (backoff corto y acotado). */
const REINTENTOS_MS = [400, 1200, 3000];

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface BootstrapOptions {
  /** Inyectable para tests (evita esperas reales). */
  sleep?: (ms: number) => Promise<void>;
  /** Esperas entre reintentos; por defecto `REINTENTOS_MS`. */
  retries?: readonly number[];
}

/**
 * Restaura la sesión al cargar la app (US-91). El access token vive solo en
 * memoria, así que tras una recarga no hay token: se intenta un `refresh()` que
 * usa la cookie `httpOnly` del refresh token. Si lo consigue, se obtiene el
 * usuario con `/auth/status`.
 *
 * **US-234 (AUD3-25) — reintento con backoff.** Antes bastaba un fallo de red
 * para acabar en el login: el arranque de la PWA en el móvil ocurre justo cuando
 * el túnel (WireGuard/Tailscale) todavía se está levantando, y el propio
 * actualizador de US-190 reinicia el agente a media sesión. Ahora:
 *   · si el agente responde **401/403** → la cookie no vale, al login **sin reintentar**;
 *   · si **no se puede hablar** con el agente → se reintenta con backoff corto y,
 *     si aun así no hay suerte, se devuelve `false` **sin borrar la sesión**, de
 *     modo que un refresh posterior la recupere sin volver a teclear la contraseña.
 */
export async function bootstrapSession(opts: BootstrapOptions = {}): Promise<boolean> {
  const sleep = opts.sleep ?? dormir;
  const esperas = opts.retries ?? REINTENTOS_MS;

  for (let intento = 0; ; intento++) {
    if (await useAuthStore.getState().refresh()) break;

    // La cookie ya no vale: reintentar no la va a resucitar.
    if (useAuthStore.getState().lastRefreshFailure === 'expired') return false;
    if (intento >= esperas.length) return false;
    await sleep(esperas[intento]!);
  }

  try {
    const user = await api.get<User>('/auth/status');
    useAuthStore.setState({ user });
    return true;
  } catch {
    // Aquí sí se limpia: hubo refresh válido pero el perfil no se pudo leer, así
    // que la app no tiene con qué renderizar una sesión coherente.
    useAuthStore.setState({ user: null, tokens: null });
    return false;
  }
}
