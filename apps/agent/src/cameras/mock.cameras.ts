import type { Camera, CameraManager, CameraSnapshot } from '@krakenos/types';

/** Genera un snapshot SVG sintético (cambia con la hora, simula "en vivo"). */
function buildSnapshot(name: string, at: Date): string {
  const time = at.toLocaleTimeString();
  // Barra que se mueve con los segundos para dar sensación de vídeo en vivo.
  const x = 40 + (at.getSeconds() / 60) * 480;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
  <rect width="640" height="360" fill="#0b1220"/>
  <rect x="${x.toFixed(0)}" y="120" width="80" height="120" fill="#1e2a3a"/>
  <circle cx="28" cy="28" r="8" fill="#ef4444"/>
  <text x="44" y="34" fill="#ef4444" font-family="monospace" font-size="18">REC</text>
  <text x="20" y="340" fill="#94a3b8" font-family="monospace" font-size="20">${name}</text>
  <text x="440" y="340" fill="#94a3b8" font-family="monospace" font-size="20">${time}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Fuente de cámaras en memoria para desarrollo. */
export class MockCameraManager implements CameraManager {
  readonly kind = 'mock' as const;
  private readonly cameras: Camera[] = [
    { id: 'cam-entrada', name: 'Entrada', room: 'Exterior', model: 'KrakenCam 1080p', online: true },
    { id: 'cam-patio', name: 'Patio', room: 'Exterior', model: 'KrakenCam 1080p', online: true },
    { id: 'cam-garaje', name: 'Garaje', room: 'Garaje', model: 'KrakenCam 720p', online: false },
  ];

  async listCameras(): Promise<Camera[]> {
    return this.cameras;
  }

  async getSnapshot(id: string): Promise<CameraSnapshot | null> {
    const camera = this.cameras.find((c) => c.id === id);
    if (!camera || !camera.online) return null;
    const at = new Date();
    return { cameraId: id, image: buildSnapshot(camera.name, at), capturedAt: at.toISOString() };
  }
}
