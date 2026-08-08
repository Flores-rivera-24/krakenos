import type { HomeMode, PresenceEvent, PresenceState } from '@krakenos/types';
import { api } from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';

export const getPresence = () => api.get<PresenceState>('/presence');
export const getPresenceTimeline = (limit = 20) =>
  api.getList<PresenceEvent>(`/presence/timeline?limit=${limit}`);
export const setHomeMode = (mode: HomeMode) =>
  api.post<PresenceState>('/presence/mode', { mode });

/** Etiquetas y glifos humanos de los modos del hogar (US-169). */
/**
 * Etiqueta de cada modo del hogar, ya traducida al idioma activo.
 *
 * US-270: era un `Record<HomeMode, string>` con el copy en español escrito aquí,
 * así que el modo salía en español con la app en inglés — tanto en el widget como
 * dentro de las frases de las rutinas. Se conserva la forma de mapa (los
 * consumidores indexan por modo), pero los valores son **claves**.
 */
export const MODE_LABEL_KEYS: Record<HomeMode, TranslationKey> = {
  home: 'homeMode.home',
  away: 'homeMode.away',
  night: 'homeMode.night',
};


export const MODE_GLYPHS: Record<HomeMode, string> = {
  home: '🏠',
  away: '🚪',
  night: '🌙',
};
