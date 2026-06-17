import type { Id, IsoDateTime } from './common.js';

/** Implementaciones de fuente de cámaras disponibles. */
export type CameraKind = 'mock' | 'rtsp';

/** Cámara IP gestionada por el agente (la URL RTSP nunca se expone en la API). */
export interface Camera {
  id: Id;
  name: string;
  room: string | null;
  model: string | null;
  online: boolean;
}

/** Captura puntual de una cámara. */
export interface CameraSnapshot {
  cameraId: Id;
  /** Imagen como data URL (en mock, un SVG; en real, un JPEG del stream). */
  image: string;
  capturedAt: IsoDateTime;
}

/**
 * Fuente de cámaras intercambiable. `mock` genera snapshots sintéticos; la
 * implementación `rtsp` real requiere un transcodificador (ffmpeg/go2rtc) para
 * llevar el stream al navegador (HLS/WebRTC) — pieza de producción pendiente.
 */
export interface CameraManager {
  listCameras(): Promise<Camera[]>;
  /** Snapshot de una cámara online, o `null` si no existe o está offline. */
  getSnapshot(id: Id): Promise<CameraSnapshot | null>;
}
