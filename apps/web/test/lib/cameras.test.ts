import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), post: vi.fn(), patch: vi.fn(), del: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { startStream, stopStream, streamPlaylistUrl } from '@/lib/cameras';

describe('lib/cameras streaming (US-185)', () => {
  it('startStream/stopStream llaman al endpoint de stream de la cámara', () => {
    startStream('cam-1');
    expect(apiMock.post).toHaveBeenCalledWith('/cameras/cam-1/stream');
    stopStream('cam-1');
    expect(apiMock.del).toHaveBeenCalledWith('/cameras/cam-1/stream');
  });

  it('streamPlaylistUrl construye la URL con el token codificado', () => {
    expect(streamPlaylistUrl('cam-1', 'abc.def')).toBe(
      '/api/cameras/cam-1/stream/index.m3u8?st=abc.def',
    );
    // El token se URL-encodea (evita romper la query con caracteres especiales).
    expect(streamPlaylistUrl('cam-1', 'a b&c')).toBe(
      '/api/cameras/cam-1/stream/index.m3u8?st=a%20b%26c',
    );
  });
});
