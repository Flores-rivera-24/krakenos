import type { Camera } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `ApiRequestError` con `status` para ejercitar la rama del límite (429).
// Vía `vi.hoisted` para que exista antes del `vi.mock` (que se sube al top).
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      readonly status: number,
      readonly body: { code: string; message: string },
    ) {
      super(body.message);
    }
  }
  return { FakeApiError };
});
vi.mock('@/lib/api', () => ({ ApiRequestError: FakeApiError }));

const camerasMock = vi.hoisted(() => ({
  startStream: vi.fn(),
  stopStream: vi.fn(),
  streamPlaylistUrl: vi.fn(),
}));
vi.mock('@/lib/cameras', () => camerasMock);

import { CameraLivePlayer } from '@/components/cameras/CameraLivePlayer';

const CAM: Camera = { id: 'cam-1', name: 'Entrada', room: 'Exterior', model: 'X', online: true };

describe('CameraLivePlayer (US-185)', () => {
  beforeEach(() => {
    camerasMock.startStream.mockReset();
    camerasMock.stopStream.mockReset().mockResolvedValue(undefined);
    camerasMock.streamPlaylistUrl
      .mockReset()
      .mockImplementation((id: string, token: string) => `/api/cameras/${id}/stream/x.m3u8?st=${token}`);
    // Fuerza la ruta de HLS nativo (Safari): evita importar hls.js en jsdom.
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('arranca el stream y carga la playlist en el <video> (HLS nativo)', async () => {
    camerasMock.startStream.mockResolvedValue({
      cameraId: 'cam-1',
      startedAt: '2026-07-10T00:00:00.000Z',
      token: 'tok123',
      expiresIn: 300,
    });
    const { container } = render(<CameraLivePlayer camera={CAM} />);

    await waitFor(() => expect(camerasMock.startStream).toHaveBeenCalledWith('cam-1'));
    const video = container.querySelector('video') as HTMLVideoElement;
    await waitFor(() =>
      expect(video.getAttribute('src')).toBe('/api/cameras/cam-1/stream/x.m3u8?st=tok123'),
    );
  });

  it('detiene el stream al desmontarse (no transcodificar cuando nadie mira)', async () => {
    camerasMock.startStream.mockResolvedValue({
      cameraId: 'cam-1',
      startedAt: '2026-07-10T00:00:00.000Z',
      token: 'tok',
      expiresIn: 300,
    });
    const { unmount } = render(<CameraLivePlayer camera={CAM} />);
    await waitFor(() => expect(camerasMock.startStream).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(camerasMock.stopStream).toHaveBeenCalledWith('cam-1'));
  });

  it('muestra un mensaje claro cuando se alcanza el límite de streams (429)', async () => {
    camerasMock.startStream.mockRejectedValue(
      new FakeApiError(429, { code: 'STREAM_LIMIT_REACHED', message: 'x' }),
    );
    render(<CameraLivePlayer camera={CAM} />);
    expect(await screen.findByText(/Demasiadas cámaras en vivo/)).toBeInTheDocument();
    // No intenta liberar una sesión que nunca arrancó.
    expect(camerasMock.stopStream).not.toHaveBeenCalled();
  });
});
