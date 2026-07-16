import { describe, expect, it } from 'vitest';
import { FrigateCameraManager, type FrigateFetch } from '../../src/cameras/frigate.cameras.js';

const CONFIG = JSON.stringify({ cameras: { entrada: { enabled: true } } });
const EVENTS = JSON.stringify([
  {
    id: 'ev1',
    camera: 'entrada',
    label: 'person',
    start_time: 1700000100,
    end_time: 1700000110,
    has_clip: true,
    thumbnail: 'AAAA',
  },
]);
const PLAYLIST = '#EXTM3U\n#EXTINF:2.0,\nseg0.m4s?src=entrada\n';

/** Transporte falso: registra las URLs pedidas y responde por patrón. */
function fakeFetch(log: string[]): FrigateFetch {
  return async (url: string) => {
    log.push(url);
    const body = url.includes('/api/config')
      ? CONFIG
      : url.includes('/api/events')
        ? EVENTS
        : url.includes('stream.m3u8')
          ? PLAYLIST
          : 'BYTES';
    return {
      ok: true,
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
    };
  };
}

function manager(log: string[] = [], now = () => 1_000_000): FrigateCameraManager {
  return new FrigateCameraManager({
    baseUrl: 'http://frigate.lan:5000/',
    fetchImpl: fakeFetch(log),
    now,
    idleTimeoutMs: 60_000,
  });
}

describe('FrigateCameraManager (US-214)', () => {
  it('lista las cámaras del config y captura snapshot como data URL', async () => {
    const m = manager();
    const cameras = await m.listCameras();
    expect(cameras).toHaveLength(1);
    const snap = await m.getSnapshot('entrada');
    expect(snap?.image.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(await m.getSnapshot('no-existe')).toBeNull();
  });

  it('el stream proxy no filtra la URL del NVR y sirve segmentos por mapa exacto', async () => {
    const log: string[] = [];
    const m = manager(log);
    expect(await m.startStream('entrada')).toMatchObject({ cameraId: 'entrada' });
    const playlist = await m.readStreamPlaylist('entrada');
    expect(playlist).not.toBeNull();
    expect(playlist).not.toContain('frigate.lan'); // no-fuga hacia el cliente
    expect(playlist).toContain('f0.m4s');
    // El segmento se resuelve por búsqueda exacta (sin rutas → sin traversal).
    const bytes = await m.readStreamSegment('entrada', 'f0.m4s');
    expect(bytes).not.toBeNull();
    expect(await m.readStreamSegment('entrada', '../../etc/passwd')).toBeNull();
    expect(await m.readStreamSegment('entrada', 'inventado.ts')).toBeNull();
    // La petición remota fue al go2rtc derivado (mismo host, puerto 1984).
    expect(log.some((u) => u.startsWith('http://frigate.lan:1984/api/stream.m3u8'))).toBe(true);
  });

  it('sin sesión no hay playlist ni segmentos; stop/reap las limpian', async () => {
    let nowMs = 1_000_000;
    const m = new FrigateCameraManager({
      baseUrl: 'http://frigate.lan:5000',
      fetchImpl: fakeFetch([]),
      now: () => nowMs,
      idleTimeoutMs: 1_000,
    });
    expect(await m.readStreamPlaylist('entrada')).toBeNull();
    await m.startStream('entrada');
    expect(await m.readStreamPlaylist('entrada')).not.toBeNull();
    nowMs += 5_000; // supera el idle
    expect(m.reapIdleStreams()).toBe(1);
    expect(await m.readStreamPlaylist('entrada')).toBeNull();
  });

  it('pollEvents devuelve eventos con label posteriores a sinceMs', async () => {
    const m = manager();
    const events = await m.pollEvents(1700000000_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ cameraId: 'entrada', label: 'person' });
    // Re-filtrado fino: un since posterior al evento lo excluye.
    expect(await m.pollEvents(1700000200_000)).toEqual([]);
  });

  it('grabaciones nativas: lista por proxy y descarga por id prefijado', async () => {
    const log: string[] = [];
    const m = manager(log);
    const recordings = await m.listNativeRecordings('entrada');
    expect(recordings[0]).toMatchObject({ id: 'frg-ev1', cameraId: 'entrada' });
    expect(await m.readNativeRecording('frg-ev1')).not.toBeNull();
    expect(log.some((u) => u.includes('/api/events/ev1/clip.mp4'))).toBe(true);
    // Un id sin el prefijo nativo jamás alcanza el NVR.
    expect(await m.readNativeRecording('local-uuid')).toBeNull();
  });

  it('sin detección ni clips locales: getMotionFrame y recordClip son null', async () => {
    const m = manager();
    expect(await m.getMotionFrame()).toBeNull();
    expect(await m.recordClip()).toBeNull();
  });

  it('un transporte caído degrada a vacío/null, nunca lanza', async () => {
    const broken = new FrigateCameraManager({
      baseUrl: 'http://frigate.lan:5000',
      fetchImpl: async () => {
        throw new Error('conexión rechazada');
      },
    });
    expect(await broken.listCameras()).toEqual([]);
    expect(await broken.getSnapshot('entrada')).toBeNull();
    expect(await broken.pollEvents(0)).toEqual([]);
    expect(await broken.listNativeRecordings()).toEqual([]);
  });
});
