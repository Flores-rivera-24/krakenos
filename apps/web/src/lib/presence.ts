import type { HomeMode, PresenceEvent, PresenceState } from '@krakenos/types';
import { api } from '@/lib/api';

export const getPresence = () => api.get<PresenceState>('/presence');
export const getPresenceTimeline = (limit = 20) =>
  api.getList<PresenceEvent>(`/presence/timeline?limit=${limit}`);
export const setHomeMode = (mode: HomeMode) =>
  api.post<PresenceState>('/presence/mode', { mode });

/** Etiquetas y glifos humanos de los modos del hogar (US-169). */
export const MODE_LABELS: Record<HomeMode, string> = {
  home: 'En casa',
  away: 'Fuera',
  night: 'Noche',
};

export const MODE_GLYPHS: Record<HomeMode, string> = {
  home: '🏠',
  away: '🚪',
  night: '🌙',
};
