import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Camera, CameraManager, CameraSnapshot, CameraStreamSession } from '@krakenos/types';
import { MOTION_FRAME_HEIGHT, MOTION_FRAME_WIDTH } from '@krakenos/types';
import {
  HLS_PLAYLIST_NAME,
  HlsStreamManager,
  type StreamSpawner,
} from './hls-stream.js';

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

/**
 * `StreamSpawner` sintético para desarrollo/tests: escribe **al instante** una
 * playlist HLS válida y un par de segmentos de relleno en `outputDir`, de modo
 * que el reproductor tiene algo que pedir sin ffmpeg ni una cámara real
 * (mock-first, US-185). No hay proceso que matar: `stop()` es un no-op.
 */
export const mockStreamSpawner: StreamSpawner = ({ outputDir }) => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXTINF:2.0,',
    'seg0.ts',
    '#EXTINF:2.0,',
    'seg1.ts',
    '',
  ].join('\n');
  writeFileSync(join(outputDir, HLS_PLAYLIST_NAME), playlist);
  // Bytes de relleno con la firma de un paquete MPEG-TS (0x47) — no es vídeo real,
  // pero deja que las rutas y el reproductor ejerciten el flujo completo.
  writeFileSync(join(outputDir, 'seg0.ts'), Buffer.from([0x47, 0x40, 0x00, 0x10]));
  writeFileSync(join(outputDir, 'seg1.ts'), Buffer.from([0x47, 0x40, 0x00, 0x11]));
  return { stop() {} };
};

export interface MockCameraOptions {
  /** Directorio base para los segmentos HLS. Por defecto, uno en el tmp del SO. */
  hlsBaseDir?: string;
  maxConcurrent?: number;
  idleTimeoutMs?: number;
  now?: () => number;
}

/** Fuente de cámaras en memoria para desarrollo. */
export class MockCameraManager implements CameraManager {
  readonly kind = 'mock' as const;
  private readonly cameras: Camera[] = [
    { id: 'cam-entrada', name: 'Entrada', room: 'Exterior', model: 'KrakenCam 1080p', online: true },
    { id: 'cam-patio', name: 'Patio', room: 'Exterior', model: 'KrakenCam 1080p', online: true },
    { id: 'cam-garaje', name: 'Garaje', room: 'Garaje', model: 'KrakenCam 720p', online: false },
  ];
  private readonly hls: HlsStreamManager;
  private readonly clock: () => number;

  constructor(opts: MockCameraOptions = {}) {
    this.clock = opts.now ?? Date.now;
    this.hls = new HlsStreamManager({
      // Dir único por instancia: dev y tests no colisionan al usar los mismos ids.
      baseDir: opts.hlsBaseDir ?? join(tmpdir(), 'krakenos-hls-mock', randomUUID()),
      spawn: mockStreamSpawner,
      maxConcurrent: opts.maxConcurrent,
      idleTimeoutMs: opts.idleTimeoutMs,
      now: opts.now,
    });
  }

  async listCameras(): Promise<Camera[]> {
    return this.cameras;
  }

  async getSnapshot(id: string): Promise<CameraSnapshot | null> {
    const camera = this.cameras.find((c) => c.id === id);
    if (!camera || !camera.online) return null;
    const at = new Date();
    return { cameraId: id, image: buildSnapshot(camera.name, at), capturedAt: at.toISOString() };
  }

  async startStream(id: string): Promise<CameraStreamSession | null> {
    const camera = this.cameras.find((c) => c.id === id);
    if (!camera || !camera.online) return null;
    return this.hls.start(id, `mock://${id}`);
  }

  async getMotionFrame(id: string): Promise<Uint8Array | null> {
    const camera = this.cameras.find((c) => c.id === id);
    if (!camera || !camera.online) return null;
    // Fondo gris con un bloque brillante que se desplaza cada ~8 s: estático
    // entre saltos (sin movimiento) y con un cambio localizado en cada salto
    // (movimiento), para poder demostrar la detección al activarla en un mock.
    const w = MOTION_FRAME_WIDTH;
    const h = MOTION_FRAME_HEIGHT;
    const frame = new Uint8Array(w * h).fill(40);
    const bucket = Math.floor(this.clock() / 8000);
    const blockX = bucket % (w - 4);
    for (let y = Math.floor(h / 3); y < Math.floor((2 * h) / 3); y++) {
      for (let x = blockX; x < blockX + 4; x++) frame[y * w + x] = 210;
    }
    return frame;
  }

  async stopStream(id: string): Promise<void> {
    await this.hls.stop(id);
  }

  async readStreamPlaylist(id: string): Promise<string | null> {
    return this.hls.readPlaylist(id);
  }

  async readStreamSegment(id: string, segment: string): Promise<Uint8Array | null> {
    return this.hls.readSegment(id, segment);
  }

  reapIdleStreams(): number {
    return this.hls.reapIdle();
  }

  async recordClip(id: string, durationSec: number): Promise<Uint8Array | null> {
    const camera = this.cameras.find((c) => c.id === id);
    if (!camera || !camera.online) return null;
    // Clip sintético: cabecera MP4 mínima (`ftyp` isom) + relleno proporcional a la
    // duración. No es vídeo reproducible real, pero ejercita grabar→guardar→podar.
    const header = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
      0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
    ]);
    const filler = Buffer.alloc(Math.max(1, durationSec) * 1024, 0x21);
    return new Uint8Array(Buffer.concat([header, filler]));
  }

  async stop(): Promise<void> {
    await this.hls.stopAll();
  }
}
