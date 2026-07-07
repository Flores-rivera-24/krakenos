import type { Id, IsoDateTime } from './common.js';

/**
 * Icono de una habitación. Clave estable mapeada a un glifo/emoji en el frontend
 * (no una URL): así la habitación se reconoce de un vistazo sin depender de assets.
 */
export type RoomIcon =
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'office'
  | 'dining'
  | 'garage'
  | 'garden'
  | 'kids'
  | 'generic';

/** Habitación / grupo de dispositivos del hogar (US-165). */
export interface Room {
  id: Id;
  name: string;
  icon: RoomIcon;
  /** Orden de presentación (asc); a igualdad, por antigüedad. */
  order: number;
  createdAt: IsoDateTime;
}

/**
 * Habitación con el estado **agregado** de los dispositivos que contiene, para
 * pintar los tiles táctiles de la vista Habitaciones sin N peticiones extra.
 */
export interface RoomWithState extends Room {
  /** Dispositivos de red (inventario) asignados a la habitación. */
  deviceCount: number;
  /** Dispositivos IoT asignados a la habitación. */
  iotCount: number;
  /** Luces/enchufes controlables (on ≠ null) entre los IoT de la habitación. */
  controllableCount: number;
  /** Cuántos de esos controlables están encendidos ahora. */
  onCount: number;
  /** `true` si algún IoT asignado está inaccesible en el último snapshot. */
  anyUnreachable: boolean;
  /** Ids (del `IotManager`) de los dispositivos IoT asignados a esta habitación. */
  iotDeviceIds: string[];
}

/** Alta de habitación (`POST /api/rooms`). */
export interface CreateRoomRequest {
  name: string;
  icon?: RoomIcon;
  order?: number;
}

/** Cambios parciales de una habitación (`PATCH /api/rooms/:id`). */
export interface UpdateRoomRequest {
  name?: string;
  icon?: RoomIcon;
  order?: number;
}

/**
 * Asignación de un dispositivo a una habitación (o desasignación con `roomId:
 * null`). `kind` distingue el dispositivo de red (por `id` de inventario) del
 * IoT (por `id` del `IotManager`, que vive fuera de la tabla `Device`).
 */
export interface AssignRoomRequest {
  kind: 'device' | 'iot';
  /** `id` del `Device` de inventario, o `id` del dispositivo en el `IotManager`. */
  ref: string;
  roomId: string | null;
}

/** Acción de grupo sobre todos los IoT controlables de una habitación (US-165). */
export interface RoomGroupActionRequest {
  on?: boolean;
  brightness?: number;
}

/** Resultado de una acción de grupo: reporta los fallos parciales por dispositivo. */
export interface RoomActionResult {
  /** Dispositivos a los que se aplicó con éxito. */
  applied: number;
  /** Dispositivos que fallaron, con el motivo. */
  failed: { deviceId: string; error: string }[];
}
