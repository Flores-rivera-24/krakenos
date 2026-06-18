import { readFileSync } from 'node:fs';
import type { Camera, CameraManager, CameraSnapshot } from '@krakenos/types';
import { type FfmpegExec, buildSnapshotArgs, jpegToDataUrl } from './ffmpeg.js';

/** Definición de una cámara en la config (la `rtspUrl` nunca se expone en la API). */
export interface CameraDefinition {
  id: string;
  name: string;
  room?: string | null;
  model?: string | null;
  /** URL RTSP del stream, p. ej. `rtsp://user:pass@10.0.0.5:554/stream1`. */
  rtspUrl: string;
  /** Marca la cámara como deshabilitada (online=false) sin quitarla. */
  enabled?: boolean;
}

export interface RtspCameraOptions {
  cameras: CameraDefinition[];
  exec: FfmpegExec;
  transport?: string;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

/**
 * Fuente de cámaras real sobre **RTSP + ffmpeg**. El inventario viene de la
 * config (sin exponer la `rtspUrl`); `getSnapshot` captura un fotograma del
 * stream con ffmpeg (vía un `FfmpegExec` inyectable) y lo devuelve como JPEG en
 * data URL. Si ffmpeg falla (cámara inalcanzable), se trata como offline (`null`).
 *
 * El streaming continuo a navegador (HLS/WebRTC) queda fuera del contrato
 * actual (`CameraManager` solo expone snapshot); sería un transcodificador aparte.
 */
export class RtspCameraManager implements CameraManager {
  readonly kind = 'rtsp' as const;
  private readonly now: () => number;

  constructor(private readonly opts: RtspCameraOptions) {
    this.now = opts.now ?? Date.now;
  }

  async listCameras(): Promise<Camera[]> {
    return this.opts.cameras.map((c) => ({
      id: c.id,
      name: c.name,
      room: c.room ?? null,
      model: c.model ?? null,
      online: c.enabled ?? true,
    }));
  }

  async getSnapshot(id: string): Promise<CameraSnapshot | null> {
    const camera = this.opts.cameras.find((c) => c.id === id);
    if (!camera || camera.enabled === false) return null;

    const { stdout, code } = await this.opts.exec(
      buildSnapshotArgs(camera.rtspUrl, { transport: this.opts.transport }),
    );
    // ffmpeg falló o no produjo imagen: la cámara está inalcanzable.
    if (code !== 0 || stdout.length === 0) return null;

    return {
      cameraId: id,
      image: jpegToDataUrl(stdout),
      capturedAt: new Date(this.now()).toISOString(),
    };
  }
}

/**
 * Carga las definiciones de cámaras desde un fichero JSON (array de
 * `CameraDefinition`). Devuelve `[]` si el fichero no existe o es inválido.
 */
export function loadCameraDefinitions(path: string): CameraDefinition[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is CameraDefinition =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as CameraDefinition).id === 'string' &&
        typeof (c as CameraDefinition).rtspUrl === 'string',
    );
  } catch {
    return [];
  }
}
