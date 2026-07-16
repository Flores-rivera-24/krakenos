import type {
  Camera,
  CameraManager,
  CameraSnapshot,
  HomeEvent,
  NativeCameraEvent,
  Recording,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { MotionService } from '../../src/modules/cameras/motion.service.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

const RECORDING: Recording = {
  id: 'frg-ev1',
  cameraId: 'entrada',
  cameraName: 'entrada (person)',
  startedAt: '2026-07-16T10:00:00.000Z',
  durationSec: 10,
  sizeBytes: 0,
  snapshot: null,
};

/** Manager falso estilo Frigate: detección y grabaciones NATIVAS (US-214). */
class FakeNativeCameras implements CameraManager {
  pending: NativeCameraEvent[] = [];
  recorded: string[] = [];
  async listCameras(): Promise<Camera[]> {
    return [{ id: 'entrada', name: 'entrada', room: null, model: null, online: true }];
  }
  async getSnapshot(id: string): Promise<CameraSnapshot | null> {
    return { cameraId: id, image: 'data:image/jpeg;base64,X', capturedAt: '2026-07-16T10:00:00.000Z' };
  }
  async getMotionFrame(): Promise<Uint8Array | null> {
    return null; // sin frame-diff: la detección es nativa
  }
  async recordClip(): Promise<Uint8Array | null> {
    return null;
  }
  async startStream() {
    return null;
  }
  async stopStream() {}
  async readStreamPlaylist() {
    return null;
  }
  async readStreamSegment() {
    return null;
  }
  reapIdleStreams() {
    return 0;
  }
  async stop() {}
  async pollEvents(): Promise<NativeCameraEvent[]> {
    const out = this.pending;
    this.pending = [];
    return out;
  }
  async listNativeRecordings(cameraId?: string): Promise<Recording[]> {
    return cameraId && cameraId !== 'entrada' ? [] : [RECORDING];
  }
  async readNativeRecording(id: string): Promise<Uint8Array | null> {
    return id === 'frg-ev1' ? new TextEncoder().encode('MP4') : null;
  }
}

const nativeEvent = (over: Partial<NativeCameraEvent> = {}): NativeCameraEvent => ({
  cameraId: 'entrada',
  cameraName: 'entrada',
  detectedAt: '2026-07-16T10:00:00.000Z',
  label: 'person',
  snapshot: 'data:image/jpeg;base64,THUMB',
  ...over,
});

describe('detección nativa (Frigate, US-214)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: false });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
  });

  it('publica motion-detected con label y registra el evento; NO graba clip local', async () => {
    const cameras = new FakeNativeCameras();
    const bus = new HomeEventBus(() => {});
    const events: HomeEvent[] = [];
    bus.subscribe((e) => void events.push(e));
    const recorder = { record: vi.fn().mockResolvedValue(undefined) };
    let nowMs = 1_000_000;
    const motion = new MotionService(app, cameras, bus, { now: () => nowMs, recorder });

    // El aviso se activa por cámara (aunque `record` esté puesto, nativo no graba).
    await motion.setConfig('entrada', { enabled: true, record: true });
    cameras.pending = [nativeEvent()];
    await motion.tick(new Date('2026-07-16T10:00:00.000Z'));

    expect(events).toEqual([
      { type: 'motion-detected', cameraId: 'entrada', cameraName: 'entrada', label: 'person' },
    ]);
    expect(recorder.record).not.toHaveBeenCalled();
    const recent = motion.recentEvents('entrada');
    expect(recent[0]).toMatchObject({ label: 'person', snapshot: 'data:image/jpeg;base64,THUMB' });

    // Cooldown: un segundo evento inmediato de la misma cámara no re-dispara.
    cameras.pending = [nativeEvent()];
    nowMs += 1_000;
    await motion.tick(new Date('2026-07-16T10:00:01.000Z'));
    expect(events).toHaveLength(1);
  });

  it('sin activar por cámara, los eventos nativos no avisan (opt-in US-186)', async () => {
    const cameras = new FakeNativeCameras();
    const bus = new HomeEventBus(() => {});
    const events: HomeEvent[] = [];
    bus.subscribe((e) => void events.push(e));
    const motion = new MotionService(app, cameras, bus, { now: () => 1 });

    cameras.pending = [nativeEvent()];
    await motion.tick();
    expect(events).toEqual([]);
  });

  describe('rutas de grabaciones nativas (proxy)', () => {
    let routesApp: FastifyInstance;

    beforeAll(async () => {
      routesApp = await buildTestApp({ routes: true, cameras: new FakeNativeCameras() });
    });
    afterAll(async () => {
      await routesApp.close();
    });
    beforeEach(async () => {
      await resetDb(routesApp);
    });

    it('lista las grabaciones del NVR (sin rutas ni URLs) y descarga por proxy', async () => {
      const admin = await seedUser(routesApp, { role: 'admin' });
      const headers = authHeader(signAccess(routesApp, admin));

      const list = await routesApp.inject({ method: 'GET', url: '/api/cameras/recordings', headers });
      expect(list.statusCode).toBe(200);
      const rows = list.json() as Recording[];
      expect(rows[0]).toMatchObject({ id: 'frg-ev1', cameraId: 'entrada' });
      expect(JSON.stringify(rows)).not.toMatch(/https?:\/\//); // no-fuga de la URL del NVR

      const download = await routesApp.inject({
        method: 'GET',
        url: '/api/cameras/recordings/frg-ev1/download',
        headers,
      });
      expect(download.statusCode).toBe(200);
      expect(download.headers['content-type']).toBe('video/mp4');
      expect(download.body).toBe('MP4');
    });

    it('borrar una grabación del NVR responde 400 honesto (la retención vive en Frigate)', async () => {
      const admin = await seedUser(routesApp, { role: 'admin' });
      const res = await routesApp.inject({
        method: 'DELETE',
        url: '/api/cameras/recordings/frg-ev1',
        headers: authHeader(signAccess(routesApp, admin)),
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { code: string }).code).toBe('RECORDING_MANAGED_BY_NVR');
    });

    it('la descarga exige sesión (401 sin token)', async () => {
      const res = await routesApp.inject({
        method: 'GET',
        url: '/api/cameras/recordings/frg-ev1/download',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
