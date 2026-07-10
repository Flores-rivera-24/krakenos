import { readFileSync } from 'node:fs';
import type {
  Camera,
  CameraManager,
  CameraSnapshot,
  CameraStreamSession,
} from '@krakenos/types';
import { MOTION_FRAME_HEIGHT, MOTION_FRAME_WIDTH } from '@krakenos/types';
import {
  type FfmpegExec,
  buildMotionFrameArgs,
  buildSnapshotArgs,
  createFfmpegStreamSpawner,
  jpegToDataUrl,
} from './ffmpeg.js';
import { HlsStreamManager, type StreamSpawner } from './hls-stream.js';

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

export interface RtspHlsOptions {
  /** Directorio base de los segmentos HLS (`<baseDir>/<cameraId>`). */
  baseDir: string;
  maxConcurrent?: number;
  idleTimeoutMs?: number;
  /** Ruta del binario ffmpeg (por defecto `ffmpeg`). */
  ffmpegPath?: string;
  /** Spawner inyectable (tests); por defecto lanza ffmpeg real. */
  spawn?: StreamSpawner;
}

export interface RtspCameraOptions {
  /** Lista estática de cámaras. Alternativa a `configPath` (p. ej. en tests). */
  cameras?: CameraDefinition[];
  /**
   * Ruta del JSON de cámaras, leída **en vivo** en cada operación para reflejar el
   * alta/baja desde la UI (US-148) sin reinstanciar el manager.
   */
  configPath?: string;
  exec: FfmpegExec;
  transport?: string;
  /** Config de streaming HLS (US-185). Sin ella, el streaming queda desactivado. */
  hls?: RtspHlsOptions;
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
  private readonly hls: HlsStreamManager | null;

  constructor(private readonly opts: RtspCameraOptions) {
    this.now = opts.now ?? Date.now;
    this.hls = opts.hls
      ? new HlsStreamManager({
          baseDir: opts.hls.baseDir,
          spawn:
            opts.hls.spawn ??
            createFfmpegStreamSpawner(opts.hls.ffmpegPath, { transport: opts.transport }),
          maxConcurrent: opts.hls.maxConcurrent,
          idleTimeoutMs: opts.hls.idleTimeoutMs,
          now: opts.now,
        })
      : null;
  }

  /** Cámaras vigentes: del fichero (en vivo) si hay `configPath`, o la lista estática. */
  private getCameras(): CameraDefinition[] {
    if (this.opts.configPath) return loadCameraDefinitions(this.opts.configPath);
    return this.opts.cameras ?? [];
  }

  async listCameras(): Promise<Camera[]> {
    return this.getCameras().map((c) => ({
      id: c.id,
      name: c.name,
      room: c.room ?? null,
      model: c.model ?? null,
      online: c.enabled ?? true,
    }));
  }

  async getSnapshot(id: string): Promise<CameraSnapshot | null> {
    const camera = this.getCameras().find((c) => c.id === id);
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

  async startStream(id: string): Promise<CameraStreamSession | null> {
    if (!this.hls) return null;
    const camera = this.getCameras().find((c) => c.id === id);
    if (!camera || camera.enabled === false) return null;
    return this.hls.start(id, camera.rtspUrl);
  }

  async getMotionFrame(id: string): Promise<Uint8Array | null> {
    const camera = this.getCameras().find((c) => c.id === id);
    if (!camera || camera.enabled === false) return null;
    const { stdout, code } = await this.opts.exec(
      buildMotionFrameArgs(camera.rtspUrl, MOTION_FRAME_WIDTH, MOTION_FRAME_HEIGHT, {
        transport: this.opts.transport,
      }),
    );
    // Debe salir exactamente w*h bytes de gris; cualquier otra cosa = fallo.
    if (code !== 0 || stdout.length !== MOTION_FRAME_WIDTH * MOTION_FRAME_HEIGHT) return null;
    return new Uint8Array(stdout);
  }

  async stopStream(id: string): Promise<void> {
    await this.hls?.stop(id);
  }

  async readStreamPlaylist(id: string): Promise<string | null> {
    return this.hls?.readPlaylist(id) ?? null;
  }

  async readStreamSegment(id: string, segment: string): Promise<Uint8Array | null> {
    return this.hls?.readSegment(id, segment) ?? null;
  }

  reapIdleStreams(): number {
    return this.hls?.reapIdle() ?? 0;
  }

  async stop(): Promise<void> {
    await this.hls?.stopAll();
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
