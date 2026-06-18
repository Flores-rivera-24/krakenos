import { beforeEach, describe, expect, it } from 'vitest';
import type { FfmpegExec, FfmpegResult } from '../../src/cameras/ffmpeg.js';
import { type CameraDefinition, RtspCameraManager } from '../../src/cameras/rtsp.cameras.js';

const CAMERAS: CameraDefinition[] = [
  { id: 'cam-entrada', name: 'Entrada', room: 'Exterior', model: 'Acme', rtspUrl: 'rtsp://u:p@10.0.0.5/s1' },
  { id: 'cam-garaje', name: 'Garaje', rtspUrl: 'rtsp://10.0.0.6/s1', enabled: false },
];

/** Exec falso: registra los argv y responde con una imagen o un fallo. */
class FakeFfmpeg {
  calls: string[][] = [];
  result: FfmpegResult = { stdout: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), code: 0 };
  readonly exec: FfmpegExec = async (args) => {
    this.calls.push(args);
    return this.result;
  };
}

describe('RtspCameraManager', () => {
  let ff: FakeFfmpeg;
  let cameras: RtspCameraManager;

  beforeEach(() => {
    ff = new FakeFfmpeg();
    cameras = new RtspCameraManager({ cameras: CAMERAS, exec: ff.exec, now: () => 1_700_000_000_000 });
  });

  it('lista cámaras sin exponer la rtspUrl y refleja enabled en online', async () => {
    const list = await cameras.listCameras();
    expect(list).toEqual([
      { id: 'cam-entrada', name: 'Entrada', room: 'Exterior', model: 'Acme', online: true },
      { id: 'cam-garaje', name: 'Garaje', room: null, model: null, online: false },
    ]);
    expect(JSON.stringify(list)).not.toContain('rtsp://');
  });

  it('getSnapshot captura un JPEG y lo devuelve como data URL', async () => {
    const snap = await cameras.getSnapshot('cam-entrada');
    expect(snap).toMatchObject({ cameraId: 'cam-entrada' });
    expect(snap!.image.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(snap!.capturedAt).toBe(new Date(1_700_000_000_000).toISOString());
    // Pasó la URL real a ffmpeg.
    expect(ff.calls[0]).toContain('rtsp://u:p@10.0.0.5/s1');
  });

  it('devuelve null si la cámara no existe o está deshabilitada', async () => {
    expect(await cameras.getSnapshot('no-existe')).toBeNull();
    expect(await cameras.getSnapshot('cam-garaje')).toBeNull();
  });

  it('devuelve null si ffmpeg falla o no produce imagen', async () => {
    ff.result = { stdout: Buffer.alloc(0), code: 1 };
    expect(await cameras.getSnapshot('cam-entrada')).toBeNull();
  });
});
