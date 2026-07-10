import type { Camera, CameraManager, CameraSnapshot, HomeEvent } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { MotionService, normalizeMotionConfig } from '../../src/modules/cameras/motion.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

const CAMS: Camera[] = [
  { id: 'cam-1', name: 'Entrada', room: null, model: null, online: true },
  { id: 'cam-2', name: 'Patio', room: null, model: null, online: true },
];

/** Manager falso con fotogramas de movimiento programables por tick. */
class FakeCameras implements CameraManager {
  frames: Uint8Array[] = [];
  private idx = 0;
  async listCameras(): Promise<Camera[]> {
    return CAMS;
  }
  async getSnapshot(id: string): Promise<CameraSnapshot | null> {
    return { cameraId: id, image: 'data:image/jpeg;base64,/9j/', capturedAt: '2026-07-08T00:00:00.000Z' };
  }
  async getMotionFrame(): Promise<Uint8Array | null> {
    return this.frames[Math.min(this.idx++, this.frames.length - 1)] ?? null;
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
}

const still = () => new Uint8Array(768).fill(40);
const moving = () => {
  const f = new Uint8Array(768).fill(40);
  for (let i = 100; i < 300; i++) f[i] = 220;
  return f;
};

describe('MotionService (US-186)', () => {
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

  const build = (cameras: FakeCameras, now: () => number) => {
    const events: HomeEvent[] = [];
    const bus = new HomeEventBus();
    bus.subscribe((e) => events.push(e));
    const service = new MotionService(app, cameras, bus, { now });
    return { service, events };
  };

  it('normalizeMotionConfig acota y sanea valores corruptos', () => {
    const cfg = normalizeMotionConfig({ enabled: true, sensitivity: 'nope', cooldownSec: 999999, arming: { mode: 'x' } });
    expect(cfg.enabled).toBe(true);
    expect(cfg.sensitivity).toBe('medium'); // valor inválido → default
    expect(cfg.cooldownSec).toBe(3600); // acotado
    expect(cfg.arming).toEqual({ mode: 'always' }); // modo inválido → default
  });

  it('dispara al detectar movimiento: evento al bus + auditoría + foto Telegram', async () => {
    const cameras = new FakeCameras();
    cameras.frames = [still(), still(), moving()];
    const { service, events } = build(cameras, () => 0);
    const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
    const sendPhoto = vi.fn();
    (app as unknown as { telegram: { sendPhotoForAudit: typeof sendPhoto } }).telegram = {
      sendPhotoForAudit: sendPhoto,
    };
    await service.setConfig('cam-1', { enabled: true, sensitivity: 'medium', arming: { mode: 'always' } });

    await service.tick(new Date()); // siembra
    await service.tick(new Date()); // estático → sin movimiento
    expect(events).toHaveLength(0);
    await service.tick(new Date()); // aparece el bloque → movimiento

    expect(events).toEqual([{ type: 'motion-detected', cameraId: 'cam-1', cameraName: 'Entrada' }]);
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'camera.motion' }));
    expect(sendPhoto).toHaveBeenCalledWith('camera.motion', expect.stringContaining('Entrada'), expect.any(String));
    expect(service.recentEvents('cam-1')).toHaveLength(1);
    expect(service.recentEvents('cam-1')[0]!.snapshot).toContain('data:image/jpeg');

    auditSpy.mockRestore();
    delete (app as unknown as { telegram?: unknown }).telegram;
  });

  it('respeta el cooldown: no vuelve a disparar dentro de la ventana', async () => {
    const cameras = new FakeCameras();
    cameras.frames = [still(), moving(), still(), moving()];
    let clock = 0;
    const { service, events } = build(cameras, () => clock);
    vi.spyOn(app, 'audit').mockImplementation(() => {});
    await service.setConfig('cam-1', { enabled: true, cooldownSec: 300, arming: { mode: 'always' } });

    await service.tick(new Date()); // siembra (still)
    await service.tick(new Date()); // moving → dispara (clock=0)
    clock = 60_000; // 60 s < cooldown 300 s
    await service.tick(new Date()); // still
    await service.tick(new Date()); // moving otra vez, pero dentro del cooldown
    expect(events).toHaveLength(1);
  });

  it('no dispara si está deshabilitada o no armada', async () => {
    const cameras = new FakeCameras();
    cameras.frames = [still(), moving(), moving()];
    const { service, events } = build(cameras, () => 0);
    vi.spyOn(app, 'audit').mockImplementation(() => {});
    // Habilitada pero armado = never.
    await service.setConfig('cam-1', { enabled: true, arming: { mode: 'never' } });
    await service.tick(new Date());
    await service.tick(new Date());
    await service.tick(new Date());
    expect(events).toHaveLength(0);
  });
});
