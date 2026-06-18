import { describe, expect, it } from 'vitest';
import { buildSnapshotArgs, jpegToDataUrl } from '../../src/cameras/ffmpeg.js';

describe('buildSnapshotArgs', () => {
  it('captura un fotograma del RTSP a JPEG por stdout', () => {
    const args = buildSnapshotArgs('rtsp://cam/stream');
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe('rtsp://cam/stream');
    expect(args).toEqual(expect.arrayContaining(['-rtsp_transport', 'tcp', '-frames:v', '1', '-']));
    // Emite un único JPEG.
    expect(args).toContain('mjpeg');
  });

  it('respeta transporte y timeout configurados', () => {
    const args = buildSnapshotArgs('rtsp://cam', { transport: 'udp', timeoutMicros: 2_000_000 });
    expect(args[args.indexOf('-rtsp_transport') + 1]).toBe('udp');
    expect(args[args.indexOf('-rw_timeout') + 1]).toBe('2000000');
  });
});

describe('jpegToDataUrl', () => {
  it('codifica los bytes como data URL JPEG', () => {
    expect(jpegToDataUrl(Buffer.from([0xff, 0xd8, 0xff]))).toBe('data:image/jpeg;base64,/9j/');
  });
});
