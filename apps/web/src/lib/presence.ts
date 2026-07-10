import type { HomeMode, PresenceEvent, PresenceState } from '@krakenos/types';
import { api } from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';

export const getPresence = () => api.get<PresenceState>('/presence');
export const getPresenceTimeline = (limit = 20) =>
  api.get<PresenceEvent[]>(`/presence/timeline?limit=${limit}`);
export const setHomeMode = (mode: HomeMode) =>
  api.post<PresenceState>('/presence/mode', { mode });

/** Claves i18n de las etiquetas de los modos del hogar (US-169). */
export const MODE_LABEL_KEYS: Record<HomeMode, TranslationKey> = {
  home: 'presence.mode.home',
  away: 'presence.mode.away',
  night: 'presence.mode.night',
};

export const MODE_GLYPHS: Record<HomeMode, string> = {
  home: '🏠',
  away: '🚪',
  night: '🌙',
};
