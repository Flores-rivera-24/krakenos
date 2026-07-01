import { randomUUID } from 'node:crypto';
import type { CreateCameraRequest, ManagedCamera } from '@krakenos/types';
import type { JsonStore } from '../store/json-store.js';
import type { CameraDefinition } from './rtsp.cameras.js';

/**
 * Almacén de las cámaras gestionadas desde la UI (US-148). Persiste `CameraDefinition`
 * (incluida la `rtspUrl` con credenciales) en el mismo fichero que lee el
 * `RtspCameraManager` en vivo — así dar de alta/baja una cámara se refleja sin
 * reiniciar. La `rtspUrl` vive en un fichero local de `data/` (gitignored, permisos
 * del SO), misma postura que el store de focos Tuya y los peers de WireGuard; los
 * secretos que sí van a la base de datos se cifran aparte (secretbox, US-139).
 */
export type CameraStore = JsonStore<CameraDefinition>;

/** Construye un registro de cámara (con `id`) a partir de la petición de creación. */
export function toCameraRecord(input: CreateCameraRequest, id: string = randomUUID()): CameraDefinition {
  return {
    id,
    name: input.name,
    rtspUrl: input.rtspUrl,
    room: input.room ?? null,
    model: input.model ?? null,
    enabled: input.enabled ?? true,
  };
}

/** Vista pública de una cámara: **nunca** incluye la `rtspUrl`. */
export function toManagedCamera(rec: CameraDefinition): ManagedCamera {
  return {
    id: rec.id,
    name: rec.name,
    room: rec.room ?? null,
    model: rec.model ?? null,
    enabled: rec.enabled ?? true,
  };
}
