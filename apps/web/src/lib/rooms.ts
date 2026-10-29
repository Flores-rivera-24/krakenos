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
import {
  Bath,
  BedDouble,
  Car,
  CookingPot,
  House,
  Laptop,
  Sofa,
  ToyBrick,
  Trees,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { invalidarHabitaciones, invalidarIot, trasEscribir } from '@/lib/resources';

/**
 * Catálogo de iconos de habitación (US-165): componente de lucide. La base guarda
 * solo la clave (`Room.icon`); el icono se resuelve aquí. El orden es el que ve el
 * usuario en el selector; el nombre visible de cada icono vive en el catálogo i18n
 * (`rooms.icon.<icon>`), no aquí.
 */
export const ROOM_ICONS: { icon: RoomIcon; Icon: LucideIcon }[] = [
  { icon: 'living', Icon: Sofa },
  { icon: 'bedroom', Icon: BedDouble },
  { icon: 'kitchen', Icon: CookingPot },
  { icon: 'bathroom', Icon: Bath },
  { icon: 'dining', Icon: UtensilsCrossed },
  { icon: 'office', Icon: Laptop },
  { icon: 'kids', Icon: ToyBrick },
  { icon: 'garage', Icon: Car },
  { icon: 'garden', Icon: Trees },
  { icon: 'generic', Icon: House },
];

const ICON_BY_KEY = new Map(ROOM_ICONS.map((r) => [r.icon, r.Icon]));

/** Icono de una habitación (cae a la casa genérica si es desconocido). */
export function roomIcon(icon: RoomIcon): LucideIcon {
  return ICON_BY_KEY.get(icon) ?? House;
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
