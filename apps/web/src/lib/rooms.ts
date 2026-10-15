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
import { invalidarHabitaciones, invalidarIot, trasEscribir } from '@/lib/resources';

/**
 * Catálogo de iconos de habitación (US-165): glifo (emoji). Se pinta inline
 * (self-hosted, sin assets externos, coherente con la CSP `connect-src 'self'`).
 * El orden es el que ve el usuario en el selector; el nombre visible de cada
 * icono vive en el catálogo i18n (`rooms.icon.<icon>`), no aquí.
 */
export const ROOM_ICONS: { icon: RoomIcon; glyph: string }[] = [
  { icon: 'living', glyph: '🛋️' },
  { icon: 'bedroom', glyph: '🛏️' },
  { icon: 'kitchen', glyph: '🍳' },
  { icon: 'bathroom', glyph: '🛁' },
  { icon: 'dining', glyph: '🍽️' },
  { icon: 'office', glyph: '💻' },
  { icon: 'kids', glyph: '🧸' },
  { icon: 'garage', glyph: '🚗' },
  { icon: 'garden', glyph: '🌳' },
  { icon: 'generic', glyph: '🏠' },
];

const GLYPH_BY_ICON = new Map(ROOM_ICONS.map((r) => [r.icon, r.glyph]));

/** Glifo del icono de una habitación (cae a la casa genérica si es desconocido). */
export function roomGlyph(icon: RoomIcon): string {
  return GLYPH_BY_ICON.get(icon) ?? '🏠';
}

export const listRooms = () => api.getList<RoomWithState>('/rooms');
/**
 * Las escrituras invalidan la caché compartida (`lib/resources.ts`) **solo tras el
 * éxito**: un fallo no cambió nada en el servidor. Una habitación también la leen
 * los aparatos IoT (`room`), así que tocarla deja obsoleta esa lista.
 */
export const createRoom = (body: CreateRoomRequest) =>
  trasEscribir(api.post<Room>('/rooms', body), invalidarHabitaciones);
export const updateRoom = (id: string, body: UpdateRoomRequest) =>
  trasEscribir(api.patch<Room>(`/rooms/${id}`, body), invalidarHabitaciones, invalidarIot);
export const deleteRoom = (id: string) =>
  trasEscribir(api.del<void>(`/rooms/${id}`), invalidarHabitaciones, invalidarIot);
export const assignRoom = (body: AssignRoomRequest) =>
  trasEscribir(api.put<void>('/rooms/assign', body), invalidarHabitaciones, invalidarIot);
export const runRoomAction = (id: string, body: RoomGroupActionRequest) =>
  trasEscribir(
    api.post<RoomActionResult>(`/rooms/${id}/action`, body),
    invalidarHabitaciones,
    invalidarIot,
  );
