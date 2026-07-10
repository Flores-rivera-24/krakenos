import type {
  Camera,
  CameraMotionConfig,
  CameraStreamSession,
  CreateCameraRequest,
  ManagedCamera,
  MotionEvent,
  UpdateCameraRequest,
  UpdateMotionConfigRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';

/**
 * Envoltorio fino sobre `@/lib/api` para la gestión de cámaras (US-148).
 *
 * La `rtspUrl` (con credenciales) se **envía** al alta/edición pero el backend
 * **nunca** la devuelve: por eso `create`/`update` resuelven a `ManagedCamera`
 * (sin URL) y la edición deja el campo en blanco para "conservar la actual".
 */
export const listCameras = (): Promise<Camera[]> => api.get<Camera[]>('/cameras');

export const createCamera = (body: CreateCameraRequest): Promise<ManagedCamera> =>
  api.post<ManagedCamera>('/cameras', body);

export const updateCamera = (id: string, body: UpdateCameraRequest): Promise<ManagedCamera> =>
  api.patch<ManagedCamera>(`/cameras/${id}`, body);

export const deleteCamera = (id: string): Promise<void> => api.del<void>(`/cameras/${id}`);

/** Respuesta de arranque de stream: la sesión + el token efímero para la playlist. */
export interface StartStreamResponse extends CameraStreamSession {
  /** Token a poner en `?st=` de la playlist/segmentos. */
  token: string;
  /** Segundos de validez del token (para refrescarlo antes de que caduque). */
  expiresIn: number;
}

/**
 * Arranca (o reutiliza) el stream HLS en vivo de una cámara bajo demanda (US-185).
 * Devuelve el token efímero con el que el reproductor pide la playlist/segmentos.
 */
export const startStream = (id: string): Promise<StartStreamResponse> =>
  api.post<StartStreamResponse>(`/cameras/${id}/stream`);

/** Detiene el stream HLS de una cámara (best-effort al cerrar el reproductor). */
export const stopStream = (id: string): Promise<void> => api.del<void>(`/cameras/${id}/stream`);

/** Construye la URL (con token) de la playlist HLS que consume el reproductor. */
export const streamPlaylistUrl = (id: string, token: string): string =>
  `/api/cameras/${id}/stream/index.m3u8?st=${encodeURIComponent(token)}`;

/** Config de detección de movimiento de una cámara (US-186). */
export const getMotionConfig = (id: string): Promise<CameraMotionConfig> =>
  api.get<CameraMotionConfig>(`/cameras/${id}/motion`);

export const updateMotionConfig = (
  id: string,
  body: UpdateMotionConfigRequest,
): Promise<CameraMotionConfig> => api.put<CameraMotionConfig>(`/cameras/${id}/motion`, body);

/** Eventos de movimiento recientes (con snapshot), opcionalmente por cámara. */
export const listMotionEvents = (cameraId?: string): Promise<MotionEvent[]> =>
  api.get<MotionEvent[]>(`/cameras/motion/events${cameraId ? `?cameraId=${cameraId}` : ''}`);
