import type { CameraKind, CameraManager } from '@krakenos/types';
import { MockCameraManager } from './mock.cameras.js';

export interface CameraConfig {
  kind: CameraKind;
}

/**
 * Construye la fuente de cámaras. `mock` genera snapshots sintéticos; `rtsp`
 * real (transcodificación a HLS/WebRTC vía ffmpeg/go2rtc) queda pendiente.
 */
export function createCameraManager(config: CameraConfig): CameraManager {
  switch (config.kind) {
    case 'mock':
      return new MockCameraManager();
    case 'rtsp':
      throw new Error('Fuente RTSP real aún no implementada (requiere transcodificador)');
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Fuente de cámaras desconocida: ${String(exhaustive)}`);
    }
  }
}

export { MockCameraManager } from './mock.cameras.js';
