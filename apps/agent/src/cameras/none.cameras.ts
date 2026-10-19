import type { Camera, CameraManager, CameraSnapshot, CameraStreamSession } from '@krakenos/types';

/**
 * Cámaras «sin configurar» (`CAMERAS_KIND=none`): no hay ninguna fuente conectada, así que
 * no hay cámaras. Todo lo que se pide de una cámara concreta responde «no existe»
 * (`null`), igual que para un id desconocido: las rutas ya lo traducen a 404.
 */
export class NoneCameraManager implements CameraManager {
  readonly kind = 'none' as const;
  readonly notConfigured = true as const;

  async listCameras(): Promise<Camera[]> {
    return [];
  }

  async getSnapshot(_id: string): Promise<CameraSnapshot | null> {
    return null;
  }

  async startStream(_id: string): Promise<CameraStreamSession | null> {
    return null;
  }

  async stopStream(_id: string): Promise<void> {}

  async readStreamPlaylist(_id: string): Promise<string | null> {
    return null;
  }

  async readStreamSegment(_id: string, _segment: string): Promise<Uint8Array | null> {
    return null;
  }

  reapIdleStreams(): number {
    return 0;
  }

  async recordClip(_id: string, _durationSec: number): Promise<Uint8Array | null> {
    return null;
  }

  async getMotionFrame(_id: string): Promise<Uint8Array | null> {
    return null;
  }

  async stop(): Promise<void> {}
}
