import type { CameraKind, CameraManager } from '@krakenos/types';
import { createFfmpegExec } from './ffmpeg.js';
import { MockCameraManager } from './mock.cameras.js';
import { RtspCameraManager } from './rtsp.cameras.js';

/** Config para la fuente RTSP real (`kind: 'rtsp'`). */
export interface RtspCameraConfig {
  /** Ruta del JSON con las definiciones de cámaras (incl. `rtspUrl`). */
  configPath: string;
  /** Ruta del binario ffmpeg (por defecto `ffmpeg`). */
  ffmpegPath?: string;
  /** Transporte RTSP (`tcp` por defecto). */
  transport?: string;
}

/** Config de streaming HLS en vivo (US-185), común a mock y rtsp. */
export interface CameraHlsConfig {
  /** Directorio base de los segmentos HLS (`<baseDir>/<cameraId>`). */
  baseDir: string;
  /** Máximo de streams concurrentes (hardware modesto). */
  maxConcurrent?: number;
  /** Auto-apagado por inactividad, en ms. */
  idleTimeoutMs?: number;
}

export interface CameraConfig {
  kind: CameraKind;
  /** Requerido cuando `kind === 'rtsp'`. */
  rtsp?: RtspCameraConfig;
  /** Streaming HLS (US-185). Sin él, mock usa un tmp por defecto y rtsp lo desactiva. */
  hls?: CameraHlsConfig;
}

/**
 * Construye la fuente de cámaras. `mock` genera snapshots sintéticos; `rtsp`
 * captura un fotograma del stream con ffmpeg. El inventario `rtsp` se lee de un
 * fichero de config (la `rtspUrl` nunca se expone en la API).
 */
export function createCameraManager(config: CameraConfig): CameraManager {
  switch (config.kind) {
    case 'mock':
      return new MockCameraManager({
        hlsBaseDir: config.hls?.baseDir,
        maxConcurrent: config.hls?.maxConcurrent,
        idleTimeoutMs: config.hls?.idleTimeoutMs,
      });
    case 'rtsp': {
      const rtsp = config.rtsp;
      if (!rtsp) throw new Error('Falta la configuración RTSP (CameraConfig.rtsp)');
      return new RtspCameraManager({
        // Lee las cámaras EN VIVO del fichero (refleja el alta/baja desde la UI, US-148).
        configPath: rtsp.configPath,
        exec: createFfmpegExec(rtsp.ffmpegPath),
        transport: rtsp.transport,
        // Streaming HLS (US-185): solo si hay `hls.baseDir` configurado.
        hls: config.hls
          ? {
              baseDir: config.hls.baseDir,
              maxConcurrent: config.hls.maxConcurrent,
              idleTimeoutMs: config.hls.idleTimeoutMs,
              ffmpegPath: rtsp.ffmpegPath,
            }
          : undefined,
      });
    }
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Fuente de cámaras desconocida: ${String(exhaustive)}`);
    }
  }
}

export { MockCameraManager } from './mock.cameras.js';
export { RtspCameraManager } from './rtsp.cameras.js';
