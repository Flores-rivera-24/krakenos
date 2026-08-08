import type {
  Camera,
  CameraMotionConfig,
  CameraStreamSession,
  CreateCameraRequest,
  ManagedCamera,
  MotionEvent,
  Recording,
  RecordingConfig,
  UpdateCameraRequest,
  UpdateMotionConfigRequest,
} from '@krakenos/types';
import { ApiRequestError, api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Envoltorio fino sobre `@/lib/api` para la gestión de cámaras (US-148).
 *
 * La `rtspUrl` (con credenciales) se **envía** al alta/edición pero el backend
 * **nunca** la devuelve: por eso `create`/`update` resuelven a `ManagedCamera`
 * (sin URL) y la edición deja el campo en blanco para "conservar la actual".
 */
export const listCameras = (): Promise<Camera[]> => api.getList<Camera>('/cameras');

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
  api.getList<MotionEvent>(`/cameras/motion/events${cameraId ? `?cameraId=${cameraId}` : ''}`);

/** Clips grabados (timeline), opcionalmente por cámara (US-187). */
export const listRecordings = (cameraId?: string): Promise<Recording[]> =>
  api.getList<Recording>(`/cameras/recordings${cameraId ? `?cameraId=${cameraId}` : ''}`);

export const deleteRecording = (id: string): Promise<void> =>
  api.del<void>(`/cameras/recordings/${id}`);

/**
 * Descarga un clip **autenticado**: el token de acceso vive en memoria y un `<a>`
 * normal no lo adjuntaría (401), así que se baja con `fetch` + cabecera y se
 * dispara la descarga vía blob. Ante un 401 refresca una vez y reintenta.
 */
export async function downloadRecording(id: string): Promise<void> {
  const url = `/api/cameras/recordings/${id}/download`;
  const fetchBlob = async () => {
    const token = useAuthStore.getState().tokens?.accessToken;
    return fetch(url, {
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };
  let res = await fetchBlob();
  if (res.status === 401 && (await useAuthStore.getState().refresh())) res = await fetchBlob();
  if (!res.ok) throw new ApiRequestError(res.status, { code: 'DOWNLOAD_FAILED', message: '' });
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `${id}.mp4`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export const getRecordingConfig = (): Promise<RecordingConfig> =>
  api.get<RecordingConfig>('/cameras/recordings/config');

export const updateRecordingConfig = (body: Partial<RecordingConfig>): Promise<RecordingConfig> =>
  api.put<RecordingConfig>('/cameras/recordings/config', body);
