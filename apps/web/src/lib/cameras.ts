import type {
  Camera,
  CreateCameraRequest,
  ManagedCamera,
  UpdateCameraRequest,
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
