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

  describe('streaming HLS (US-185)', () => {
    let hlsDir: string;
    beforeAll(() => {
      hlsDir = mkdtempSync(join(tmpdir(), 'kraken-hls-'));
    });
    afterAll(() => rmSync(hlsDir, { recursive: true, force: true }));

    it('sin config hls, el streaming queda desactivado (null / 0)', async () => {
      const mgr = new RtspCameraManager({ cameras: [cam('1')], exec: okExec });
      expect(await mgr.startStream('1')).toBeNull();
      expect(await mgr.readStreamPlaylist('1')).toBeNull();
      expect(mgr.reapIdleStreams()).toBe(0);
      await mgr.stop();
    });

    it('arranca el stream pasando la rtspUrl real al spawner; offline → null', async () => {
      const urls: string[] = [];
      const mgr = new RtspCameraManager({
        cameras: [cam('1'), cam('2', { enabled: false })],
        exec: okExec,
        hls: {
          baseDir: hlsDir,
          spawn: ({ rtspUrl, outputDir }) => {
            urls.push(rtspUrl);
            writeFileSync(join(outputDir, 'index.m3u8'), '#EXTM3U\nseg0.ts\n');
            return { stop() {} };
          },
        },
      });
      const session = await mgr.startStream('1');
      expect(session?.cameraId).toBe('1');
      expect(urls).toEqual(['rtsp://10.0.0.1/s']);
      expect(await mgr.readStreamPlaylist('1')).toContain('#EXTM3U');
      // Deshabilitada no arranca (no expone su URL).
      expect(await mgr.startStream('2')).toBeNull();
      expect(urls).toEqual(['rtsp://10.0.0.1/s']);
      await mgr.stop();
    });
  });
});
