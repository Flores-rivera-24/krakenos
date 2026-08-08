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

/**
 * Catálogo de iconos de habitación (US-165): glifo (emoji) + etiqueta en
 * español. Se pinta inline (self-hosted, sin assets externos, coherente con la
 * CSP `connect-src 'self'`). El orden es el que ve el usuario en el selector.
 */
export const ROOM_ICONS: { icon: RoomIcon; glyph: string; label: string }[] = [
  { icon: 'living', glyph: '🛋️', label: 'Salón' },
  { icon: 'bedroom', glyph: '🛏️', label: 'Dormitorio' },
  { icon: 'kitchen', glyph: '🍳', label: 'Cocina' },
  { icon: 'bathroom', glyph: '🛁', label: 'Baño' },
  { icon: 'dining', glyph: '🍽️', label: 'Comedor' },
  { icon: 'office', glyph: '💻', label: 'Oficina' },
  { icon: 'kids', glyph: '🧸', label: 'Habitación infantil' },
  { icon: 'garage', glyph: '🚗', label: 'Garaje' },
  { icon: 'garden', glyph: '🌳', label: 'Jardín' },
  { icon: 'generic', glyph: '🏠', label: 'Otra' },
];

const GLYPH_BY_ICON = new Map(ROOM_ICONS.map((r) => [r.icon, r.glyph]));

/** Glifo del icono de una habitación (cae a la casa genérica si es desconocido). */
export function roomGlyph(icon: RoomIcon): string {
  return GLYPH_BY_ICON.get(icon) ?? '🏠';
}

export const listRooms = () => api.getList<RoomWithState>('/rooms');
export const createRoom = (body: CreateRoomRequest) => api.post<Room>('/rooms', body);
export const updateRoom = (id: string, body: UpdateRoomRequest) =>
  api.patch<Room>(`/rooms/${id}`, body);
export const deleteRoom = (id: string) => api.del<void>(`/rooms/${id}`);
export const assignRoom = (body: AssignRoomRequest) => api.put<void>('/rooms/assign', body);
export const runRoomAction = (id: string, body: RoomGroupActionRequest) =>
  api.post<RoomActionResult>(`/rooms/${id}/action`, body);
