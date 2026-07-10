import { describe, expect, it } from 'vitest';
import { MockCameraManager } from '../../src/cameras/mock.cameras.js';

describe('MockCameraManager', () => {
  it('lista las cámaras sembradas', async () => {
    const cams = await new MockCameraManager().listCameras();
    expect(cams.length).toBeGreaterThan(0);
    expect(cams.some((c) => c.online)).toBe(true);
    expect(cams.some((c) => !c.online)).toBe(true);
  });

  it('devuelve un snapshot (data URL) para una cámara online', async () => {
    const snap = await new MockCameraManager().getSnapshot('cam-entrada');
    expect(snap).not.toBeNull();
    expect(snap?.cameraId).toBe('cam-entrada');
    expect(snap?.image).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('devuelve null para una cámara offline', async () => {
    expect(await new MockCameraManager().getSnapshot('cam-garaje')).toBeNull();
  });

  it('devuelve null para una cámara inexistente', async () => {
    expect(await new MockCameraManager().getSnapshot('nope')).toBeNull();
  });

  it('arranca un stream HLS con playlist y segmento sintéticos (US-185)', async () => {
    const mgr = new MockCameraManager();
    const session = await mgr.startStream('cam-entrada');
    expect(session?.cameraId).toBe('cam-entrada');
    const playlist = await mgr.readStreamPlaylist('cam-entrada');
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('seg0.ts');
    const seg = await mgr.readStreamSegment('cam-entrada', 'seg0.ts');
    expect(seg?.[0]).toBe(0x47); // firma MPEG-TS
    await mgr.stop();
  });

  it('no arranca stream de una cámara offline/inexistente', async () => {
    const mgr = new MockCameraManager();
    expect(await mgr.startStream('cam-garaje')).toBeNull();
    expect(await mgr.startStream('nope')).toBeNull();
    await mgr.stop();
  });

  it('stopStream detiene la sesión (playlist deja de servirse)', async () => {
    const mgr = new MockCameraManager();
    await mgr.startStream('cam-entrada');
    expect(await mgr.readStreamPlaylist('cam-entrada')).not.toBeNull();
    await mgr.stopStream('cam-entrada');
    expect(await mgr.readStreamPlaylist('cam-entrada')).toBeNull();
    await mgr.stop();
  });
});
