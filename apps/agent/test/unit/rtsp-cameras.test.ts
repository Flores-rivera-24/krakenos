import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FfmpegExec } from '../../src/cameras/ffmpeg.js';
import { RtspCameraManager, type CameraDefinition } from '../../src/cameras/rtsp.cameras.js';

const okExec: FfmpegExec = async () => ({
  stdout: Buffer.from([0xff, 0xd8, 0xff]),
  stderr: Buffer.from(''),
  code: 0,
});

const cam = (id: string, extra: Partial<CameraDefinition> = {}): CameraDefinition => ({
  id,
  name: `Cam ${id}`,
  rtspUrl: `rtsp://10.0.0.${id}/s`,
  ...extra,
});

describe('RtspCameraManager (US-148)', () => {
  it('con lista estática devuelve las cámaras dadas', async () => {
    const mgr = new RtspCameraManager({ cameras: [cam('1'), cam('2')], exec: okExec });
    expect(await mgr.listCameras()).toHaveLength(2);
  });

  describe('con configPath (lectura en vivo)', () => {
    let dir: string;
    let path: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'kraken-cams-'));
      path = join(dir, 'cameras.json');
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('refleja los cambios del fichero sin reinstanciar', async () => {
      const mgr = new RtspCameraManager({ configPath: path, exec: okExec });
      writeFileSync(path, JSON.stringify([cam('1')]));
      expect(await mgr.listCameras()).toHaveLength(1);

      // Se añade otra cámara al fichero → la misma instancia la ve (live).
      writeFileSync(path, JSON.stringify([cam('1'), cam('2')]));
      const list = await mgr.listCameras();
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.id).sort()).toEqual(['1', '2']);
    });

    it('getSnapshot: online captura, deshabilitada/inexistente → null', async () => {
      const mgr = new RtspCameraManager({ configPath: path, exec: okExec });
      writeFileSync(path, JSON.stringify([cam('1'), cam('2', { enabled: false })]));

      expect(await mgr.getSnapshot('1')).not.toBeNull();
      expect(await mgr.getSnapshot('2')).toBeNull(); // deshabilitada
      expect(await mgr.getSnapshot('99')).toBeNull(); // inexistente
    });
  });
});
