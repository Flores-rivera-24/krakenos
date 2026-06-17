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
});
