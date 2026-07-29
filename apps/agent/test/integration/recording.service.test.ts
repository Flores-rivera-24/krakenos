import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Camera, CameraManager, CameraSnapshot } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  RecordingService,
  normalizeRecordingConfig,
} from '../../src/modules/cameras/recording.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

/** Manager falso: recordClip devuelve N bytes = durationSec (para pesar el tamaño). */
class FakeCameras implements CameraManager {
  clipBytesPerSec = 1000;
  async listCameras(): Promise<Camera[]> {
    return [{ id: 'cam-1', name: 'Entrada', room: null, model: null, online: true }];
  }
  async getSnapshot(): Promise<CameraSnapshot | null> {
    return null;
  }
  async recordClip(_id: string, durationSec: number): Promise<Uint8Array | null> {
    return new Uint8Array(durationSec * this.clipBytesPerSec).fill(1);
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
  async getMotionFrame() {
    return null;
  }
  reapIdleStreams() {
    return 0;
  }
  async stop() {}
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('RecordingService (US-187)', () => {
  let app: FastifyInstance;
  let dir: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: false });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    dir = mkdtempSync(join(tmpdir(), 'rec-svc-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const rec = (now = () => 0, cameras = new FakeCameras()) =>
    new RecordingService(app, cameras, dir, now);

  it('normalizeRecordingConfig acota valores fuera de rango', () => {
    const cfg = normalizeRecordingConfig({ retentionDays: 9999, maxTotalMb: 1, clipSeconds: 999 });
    expect(cfg).toEqual({ retentionDays: 365, maxTotalMb: 10, clipSeconds: 120 });
  });

  it('graba un clip a disco + fila y lo lista sin exponer la ruta', async () => {
    const service = rec();
    await service.record({ cameraId: 'cam-1', cameraName: 'Entrada', detectedAt: new Date(0).toISOString(), snapshot: 'data:image/jpeg;base64,x' });

    const list = await service.list('cam-1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ cameraId: 'cam-1', cameraName: 'Entrada' });
    expect(list[0]!.sizeBytes).toBeGreaterThan(0);
    expect(JSON.stringify(list[0])).not.toContain('.mp4'); // la ruta no se expone

    const row = await service.getRow(list[0]!.id);
    expect(existsSync(service.absPath(row!))).toBe(true);
  });

  it('poda por edad: borra los clips más viejos que retentionDays', async () => {
    // Se graban ambos con el reloj a 0 (ninguno se poda al insertarse), y luego se
    // avanza el reloj para que el barrido explícito pode el más viejo.
    let clock = 0;
    const service = rec(() => clock);
    await service.setConfig({ retentionDays: 14, clipSeconds: 5 });
    await service.record({ cameraId: 'cam-1', cameraName: 'E', detectedAt: new Date(0).toISOString(), snapshot: null });
    await service.record({ cameraId: 'cam-1', cameraName: 'E', detectedAt: new Date(20 * DAY_MS).toISOString(), snapshot: null });

    clock = 30 * DAY_MS; // cutoff = 16 d: el clip de día 0 queda fuera, el de día 20 dentro
    const removed = await service.prune();
    expect(removed).toBe(1);
    const list = await service.list('cam-1');
    expect(list).toHaveLength(1);
    expect(new Date(list[0]!.startedAt).getTime()).toBe(20 * DAY_MS);
  });

  it('poda por tamaño total: elimina de los más antiguos hasta bajar del tope', async () => {
    const cameras = new FakeCameras();
    cameras.clipBytesPerSec = 1024 * 1024; // 1 MB/s → clips de 3 MB (clipSeconds=3)
    let clock = 0;
    const service = rec(() => clock, cameras);
    await service.setConfig({ maxTotalMb: 10, clipSeconds: 3, retentionDays: 365 });
    // 5 clips de 3 MB (día 1..5) → 15 MB > 10 MB; el auto-prune al grabar mantiene ≤10 MB.
    for (let i = 1; i <= 5; i++) {
      clock = i * DAY_MS;
      await service.record({ cameraId: 'cam-1', cameraName: 'E', detectedAt: new Date(i * DAY_MS).toISOString(), snapshot: null });
    }
    const list = await service.list('cam-1');
    // 10 MB / 3 MB → como mucho 3 clips (los más recientes).
    expect(list.length).toBeLessThanOrEqual(3);
    const oldest = Math.min(...list.map((r) => new Date(r.startedAt).getTime()));
    expect(oldest).toBeGreaterThanOrEqual(3 * DAY_MS);
  });

  it('absPath rechaza una ruta que se salga del directorio de clips (AUD3-05)', async () => {
    const service = rec();
    await service.record({
      cameraId: 'cam-1',
      cameraName: 'E',
      detectedAt: new Date(0).toISOString(),
      snapshot: null,
    });
    const id = (await service.list())[0]!.id;

    // La fila viene de la DB, y la DB es un destino legítimo de restauración: un
    // backup preparado con esta ruta convertía la descarga de un clip en lectura
    // arbitraria de ficheros (`keys/jwt-private.pem`) y `remove()` en borrado
    // arbitrario. Se valida al USAR la ruta, no solo al desempaquetar el backup.
    for (const evil of [
      '../../../keys/jwt-private.pem',
      '/etc/passwd',
      'cam-1/../../../.env',
    ]) {
      await app.prisma.recording.update({ where: { id }, data: { path: evil } });
      const row = await service.getRow(id);
      expect(() => service.absPath(row!)).toThrow(/fuera del directorio de clips/);
      await expect(service.remove(id)).rejects.toThrow(/fuera del directorio de clips/);
    }

    // Una ruta normal sigue resolviendo dentro del directorio base.
    await app.prisma.recording.update({ where: { id }, data: { path: 'cam-1/clip.mp4' } });
    const ok = await service.getRow(id);
    expect(service.absPath(ok!)).toContain('cam-1');
  });

  it('remove borra fichero y fila; inexistente → false', async () => {
    const service = rec();
    await service.record({ cameraId: 'cam-1', cameraName: 'E', detectedAt: new Date(0).toISOString(), snapshot: null });
    const id = (await service.list())[0]!.id;
    const row = await service.getRow(id);
    expect(await service.remove(id)).toBe(true);
    expect(existsSync(service.absPath(row!))).toBe(false);
    expect(await service.list()).toHaveLength(0);
    expect(await service.remove('nope')).toBe(false);
  });
});
