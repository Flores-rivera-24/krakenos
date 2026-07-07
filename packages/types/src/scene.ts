import type { IsoDateTime } from './common.js';

/**
 * Icono de una escena (US-166). Clave estable mapeada a un glifo en el frontend
 * (no una URL), coherente con el modo self-hosted + CSP `connect-src 'self'`.
 */
export type SceneIcon =
  | 'night'
  | 'movie'
  | 'leave'
  | 'morning'
  | 'dinner'
  | 'relax'
  | 'party'
  | 'focus'
  | 'scene';

/**
 * Una acción de escena: deja un dispositivo IoT en el estado deseado. Reusa la
 * forma de `UpdateIotStateRequest` por dispositivo. Los campos ausentes no se
 * tocan (una escena puede solo encender, o solo fijar brillo, etc.).
 */
export interface SceneAction {
  /** Id del dispositivo en el `IotManager`. */
  deviceId: string;
  on?: boolean;
  brightness?: number;
  /** Color (hex `#rrggbb`) o temperatura (Kelvin); excluyentes. */
  color?: { hex?: string; temperatureK?: number };
}

/** Escena: deja N dispositivos en un estado deseado con un toque (US-166). */
export interface Scene {
  id: string;
  name: string;
  icon: SceneIcon;
  actions: SceneAction[];
  /** Orden de presentación (asc); a igualdad, por antigüedad. */
  order: number;
  createdAt: IsoDateTime;
}

/** Alta de escena (`POST /api/scenes`). */
export interface CreateSceneRequest {
  name: string;
  icon?: SceneIcon;
  actions: SceneAction[];
  order?: number;
}

/** Cambios parciales de una escena (`PATCH /api/scenes/:id`). */
export interface UpdateSceneRequest {
  name?: string;
  icon?: SceneIcon;
  actions?: SceneAction[];
  order?: number;
}

/**
 * Resultado de ejecutar una escena: reporta los fallos parciales por dispositivo
 * (un aparato caído no impide aplicar el resto).
 */
export interface SceneRunResult {
  applied: number;
  failed: { deviceId: string; error: string }[];
}

/** Captura del estado actual de N dispositivos como acciones de escena (`POST /api/scenes/capture`). */
export interface CaptureSceneRequest {
  deviceIds: string[];
}
