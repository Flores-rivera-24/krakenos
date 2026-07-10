import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HLS_PLAYLIST_NAME,
  HlsStreamManager,
  StreamLimitError,
  type StreamSpawner,
} from '../../src/cameras/hls-stream.js';

/**
 * Spawner falso: escribe una playlist y un segmento al instante (como haría
 * ffmpeg) y cuenta los `stop()`. Registra los rtspUrl recibidos.
 */
function makeSpawner(): { spawn: StreamSpawner; stops: number; urls: string[] } {
  const state = { stops: 0, urls: [] as string[] };
  const spawn: StreamSpawner = ({ rtspUrl, outputDir }) => {
    state.urls.push(rtspUrl);
    writeFileSync(join(outputDir, HLS_PLAYLIST_NAME), '#EXTM3U\nseg0.ts\n');
    writeFileSync(join(outputDir, 'seg0.ts'), Buffer.from([0x47, 0x01]));
    return {
      stop() {
        state.stops++;
      },
    };
  };
  return { spawn, get stops() { return state.stops; }, urls: state.urls };
}

describe('HlsStreamManager', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'hls-test-'));
  });
  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('arranca una sesión, escribe segmentos y sirve la playlist', () => {
    const sp = makeSpawner();
    const hls = new HlsStreamManager({ baseDir, spawn: sp.spawn, now: () => 1000 });
    const session = hls.start('cam-1', 'rtsp://x/1');
    expect(session).toEqual({ cameraId: 'cam-1', startedAt: new Date(1000).toISOString() });
    expect(sp.urls).toEqual(['rtsp://x/1']);
    expect(hls.readPlaylist('cam-1')).toContain('#EXTM3U');
    expect([...(hls.readSegment('cam-1', 'seg0.ts') ?? [])]).toEqual([0x47, 0x01]);
  });

  it('reutiliza la sesión existente sin volver a spawnear', () => {
    const sp = makeSpawner();
    const hls = new HlsStreamManager({ baseDir, spawn: sp.spawn });
    hls.start('cam-1', 'rtsp://x/1');
    hls.start('cam-1', 'rtsp://x/1');
    expect(sp.urls).toHaveLength(1);
    expect(hls.activeCount).toBe(1);
  });

  it('respeta el límite de streams concurrentes', () => {
    const sp = makeSpawner();
    const hls = new HlsStreamManager({ baseDir, spawn: sp.spawn, maxConcurrent: 2 });
    hls.start('cam-1', 'rtsp://x/1');
    hls.start('cam-2', 'rtsp://x/2');
    expect(() => hls.start('cam-3', 'rtsp://x/3')).toThrow(StreamLimitError);
    // Reutilizar una activa no cuenta contra el límite.
    expect(() => hls.start('cam-1', 'rtsp://x/1')).not.toThrow();
  });

  it('readPlaylist/readSegment devuelven null sin sesión', () => {
    const sp = makeSpawner();
    const hls = new HlsStreamManager({ baseDir, spawn: sp.spawn });
    expect(hls.readPlaylist('cam-1')).toBeNull();
    expect(hls.readSegment('cam-1', 'seg0.ts')).toBeNull();
  });

  it('rechaza nombres de segmento con path traversal', () => {
    const sp = makeSpawner();
    const hls = new HlsStreamManager({ baseDir, spawn: sp.spawn });
    hls.start('cam-1', 'rtsp://x/1');
    // Un secreto fuera del directorio de la sesión.
    writeFileSync(join(baseDir, 'secret.txt'), 'top secret');
    expect(hls.readSegment('cam-1', '../secret.txt')).toBeNull();
    expect(hls.readSegment('cam-1', '..%2Fsecret.txt')).toBeNull();
    expect(hls.readSegment('cam-1', 'seg0.png')).toBeNull();
    expect(hls.readSegment('cam-1', HLS_PLAYLIST_NAME)).toBeNull();
  });

  it('stop detiene el proceso y borra los segmentos (idempotente)', async () => {
    const sp = makeSpawner();
    const hls = new HlsStreamManager({ baseDir, spawn: sp.spawn });
    hls.start('cam-1', 'rtsp://x/1');
    const dir = join(baseDir, 'cam-1');
    expect(existsSync(dir)).toBe(true);
    await hls.stop('cam-1');
    expect(sp.stops).toBe(1);
    expect(existsSync(dir)).toBe(false);
    expect(hls.activeCount).toBe(0);
    await hls.stop('cam-1'); // idempotente
    expect(sp.stops).toBe(1);
  });

  it('reapIdle detiene solo las sesiones sin actividad reciente', () => {
    let clock = 0;
    const sp = makeSpawner();
    const hls = new HlsStreamManager({
      baseDir,
      spawn: sp.spawn,
      idleTimeoutMs: 100,
      now: () => clock,
    });
    hls.start('cam-1', 'rtsp://x/1');
    clock = 50;
    hls.start('cam-2', 'rtsp://x/2');
    clock = 120; // cam-1 lleva 120ms ocioso (>100), cam-2 solo 70ms
    // Actividad reciente sobre cam-2 la mantiene viva.
    hls.readPlaylist('cam-2');
    const reaped = hls.reapIdle();
    expect(reaped).toBe(1);
    expect(hls.activeCount).toBe(1);
    expect(hls.readPlaylist('cam-1')).toBeNull();
    expect(hls.readPlaylist('cam-2')).not.toBeNull();
  });

  it('una lectura de playlist refresca la actividad (evita el reap)', () => {
    let clock = 0;
    const sp = makeSpawner();
    const hls = new HlsStreamManager({ baseDir, spawn: sp.spawn, idleTimeoutMs: 100, now: () => clock });
    hls.start('cam-1', 'rtsp://x/1');
    clock = 90;
    hls.readPlaylist('cam-1'); // toca a t=90
    clock = 150; // 60ms desde la última actividad (<100)
    expect(hls.reapIdle()).toBe(0);
    expect(hls.activeCount).toBe(1);
  });

  it('stopAll detiene todo y limpia el directorio base', async () => {
    const sp = makeSpawner();
    const hls = new HlsStreamManager({ baseDir, spawn: sp.spawn });
    hls.start('cam-1', 'rtsp://x/1');
    hls.start('cam-2', 'rtsp://x/2');
    await hls.stopAll();
    expect(sp.stops).toBe(2);
    expect(hls.activeCount).toBe(0);
    expect(existsSync(baseDir)).toBe(false);
  });

  it('start limpia un directorio residual de una sesión anterior mal cerrada', () => {
    const sp = makeSpawner();
    // Deja basura en el dir de la cámara antes de arrancar.
    const dir = join(baseDir, 'cam-1');
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(join(baseDir, 'placeholder'), 'x');
    const hls = new HlsStreamManager({ baseDir, spawn: sp.spawn });
    hls.start('cam-1', 'rtsp://x/1');
    // Solo el nuevo contenido del spawner.
    expect(readdirSync(dir).sort()).toEqual([HLS_PLAYLIST_NAME, 'seg0.ts'].sort());
  });
});
