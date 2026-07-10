import type {
  AssignRoomRequest,
  CreateRoomRequest,
  Room,
  RoomActionResult,
  RoomGroupActionRequest,
  RoomIcon,
  RoomWithState,
  UpdateRoomRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Catálogo de iconos de habitación (US-165): glifo (emoji) + clave i18n de la
 * etiqueta. Se pinta inline (self-hosted, sin assets externos, coherente con la
 * CSP `connect-src 'self'`). El orden es el que ve el usuario en el selector.
 */
export const ROOM_ICONS: { icon: RoomIcon; glyph: string; labelKey: TranslationKey }[] = [
  { icon: 'living', glyph: '🛋️', labelKey: 'room.icon.living' },
  { icon: 'bedroom', glyph: '🛏️', labelKey: 'room.icon.bedroom' },
  { icon: 'kitchen', glyph: '🍳', labelKey: 'room.icon.kitchen' },
  { icon: 'bathroom', glyph: '🛁', labelKey: 'room.icon.bathroom' },
  { icon: 'dining', glyph: '🍽️', labelKey: 'room.icon.dining' },
  { icon: 'office', glyph: '💻', labelKey: 'room.icon.office' },
  { icon: 'kids', glyph: '🧸', labelKey: 'room.icon.kids' },
  { icon: 'garage', glyph: '🚗', labelKey: 'room.icon.garage' },
  { icon: 'garden', glyph: '🌳', labelKey: 'room.icon.garden' },
  { icon: 'generic', glyph: '🏠', labelKey: 'room.icon.generic' },
];

const GLYPH_BY_ICON = new Map(ROOM_ICONS.map((r) => [r.icon, r.glyph]));

/** Glifo del icono de una habitación (cae a la casa genérica si es desconocido). */
export function roomGlyph(icon: RoomIcon): string {
  return GLYPH_BY_ICON.get(icon) ?? '🏠';
}

export const listRooms = () => api.get<RoomWithState[]>('/rooms');
export const createRoom = (body: CreateRoomRequest) => api.post<Room>('/rooms', body);
export const updateRoom = (id: string, body: UpdateRoomRequest) =>
  api.patch<Room>(`/rooms/${id}`, body);
export const deleteRoom = (id: string) => api.del<void>(`/rooms/${id}`);
export const assignRoom = (body: AssignRoomRequest) => api.put<void>('/rooms/assign', body);
export const runRoomAction = (id: string, body: RoomGroupActionRequest) =>
  api.post<RoomActionResult>(`/rooms/${id}/action`, body);
