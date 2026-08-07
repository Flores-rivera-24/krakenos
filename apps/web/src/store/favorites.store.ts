import type { CreateFavoriteRequest, Favorite, FavoriteKind } from '@krakenos/types';
import { create } from 'zustand';
import { api } from '@/lib/api';

/** Carga en vuelo compartida, para deduplicar varias montas simultáneas (US-170). */
let inFlight: Promise<void> | null = null;

interface FavoritesState {
  favorites: Favorite[];
  loaded: boolean;
  /** Carga los favoritos del usuario (idempotente; recarga si se fuerza). */
  load: (force?: boolean) => Promise<void>;
  /** ¿Está fijado este objetivo (kind+ref)? */
  isFavorite: (kind: FavoriteKind, ref: string) => boolean;
  /** Fija/quita el objetivo según su estado actual; devuelve el nuevo estado. */
  toggle: (kind: FavoriteKind, ref: string) => Promise<boolean>;
  /** Quita un favorito por su id. */
  remove: (id: string) => Promise<void>;
  /**
   * Vacía el espejo (logout): sin esto, los favoritos del usuario anterior se
   * mostraban al siguiente que iniciara sesión en la misma pestaña (AUD-14).
   */
  reset: () => void;
}

/**
 * Favoritos por usuario (US-170). Espejo en memoria del estado del servidor
 * (persistido por usuario en la API): se carga bajo demanda y las mutaciones
 * actualizan el servidor y el espejo. No usa `persist` — la verdad vive en el
 * agente, no en `localStorage`, para que sea consistente entre dispositivos.
 */
export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: [],
  loaded: false,

  load: async (force = false) => {
    if (get().loaded && !force) return;
    if (inFlight && !force) return inFlight;
    inFlight = api
      .get<Favorite[]>('/favorites')
      .then((favorites) => {
        // El genérico de `api.get` es un CAST, no una comprobación: se verifica
        // la forma antes de guardarla, o un cuerpo inesperado deja el estado con
        // algo que no es una lista y revienta en el `for…of` de quien lo pinte.
        if (Array.isArray(favorites)) set({ favorites, loaded: true });
      })
      .catch(() => {
        // Una carga que falla (red caída, o la petición abortada al cambiar de
        // página) deja los favoritos como estaban y se reintenta la próxima vez;
        // no se marca `loaded`. Sin este `catch`, además, cada navegación rápida
        // dejaba una promesa rechazada sin dueño.
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  },

  isFavorite: (kind, ref) => get().favorites.some((f) => f.kind === kind && f.ref === ref),

  toggle: async (kind, ref) => {
    const existing = get().favorites.find((f) => f.kind === kind && f.ref === ref);
    if (existing) {
      await get().remove(existing.id);
      return false;
    }
    const body: CreateFavoriteRequest = { kind, ref };
    const created = await api.post<Favorite>('/favorites', body);
    set((s) => ({ favorites: [...s.favorites, created] }));
    return true;
  },

  remove: async (id) => {
    await api.del<void>(`/favorites/${id}`);
    set((s) => ({ favorites: s.favorites.filter((f) => f.id !== id) }));
  },

  reset: () => {
    inFlight = null;
    set({ favorites: [], loaded: false });
  },
}));
