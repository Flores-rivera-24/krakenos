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

  it('getMotionFrame: huella de gris de tamaño fijo; null si offline (US-186)', async () => {
    const mgr = new MockCameraManager();
    const frame = await mgr.getMotionFrame('cam-entrada');
    expect(frame).toBeInstanceOf(Uint8Array);
    expect(frame!.length).toBe(32 * 24);
    expect(await mgr.getMotionFrame('cam-garaje')).toBeNull(); // offline
    expect(await mgr.getMotionFrame('nope')).toBeNull();
  });

  it('getMotionFrame: el bloque se desplaza con el reloj (cambia entre buckets)', async () => {
    const a = await new MockCameraManager({ now: () => 0 }).getMotionFrame('cam-entrada');
    const b = await new MockCameraManager({ now: () => 16_000 }).getMotionFrame('cam-entrada');
    expect(Buffer.from(a!).equals(Buffer.from(b!))).toBe(false);
  });

  it('recordClip: clip sintético con cabecera MP4; null si offline (US-187)', async () => {
    const mgr = new MockCameraManager();
    const clip = await mgr.recordClip('cam-entrada', 5);
    expect(clip).toBeInstanceOf(Uint8Array);
    expect(clip!.length).toBeGreaterThan(24);
    expect(Buffer.from(clip!.subarray(4, 8)).toString()).toBe('ftyp');
    expect(await mgr.recordClip('cam-garaje', 5)).toBeNull(); // offline
  });
});
