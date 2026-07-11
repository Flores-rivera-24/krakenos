import { describe, expect, it } from 'vitest';
import {
  buildClipArgs,
  buildHlsArgs,
  buildMotionFrameArgs,
  buildSnapshotArgs,
  jpegToDataUrl,
} from '../../src/cameras/ffmpeg.js';

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

describe('buildMotionFrameArgs', () => {
  it('captura un fotograma escalado a gris en rawvideo (US-186)', () => {
    const args = buildMotionFrameArgs('rtsp://cam/s', 32, 24);
    expect(args[args.indexOf('-i') + 1]).toBe('rtsp://cam/s');
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=32:24,format=gray');
    expect(args).toEqual(expect.arrayContaining(['-frames:v', '1', '-f', 'rawvideo', '-']));
  });
});

describe('buildClipArgs', () => {
  it('graba un clip MP4 fragmentado sin recodificar (US-187)', () => {
    const args = buildClipArgs('rtsp://cam/s', 10);
    expect(args[args.indexOf('-i') + 1]).toBe('rtsp://cam/s');
    expect(args[args.indexOf('-t') + 1]).toBe('10');
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'copy', '-f', 'mp4', '-']));
    expect(args[args.indexOf('-movflags') + 1]).toContain('frag_keyframe');
  });
});

describe('jpegToDataUrl', () => {
  it('codifica los bytes como data URL JPEG', () => {
    expect(jpegToDataUrl(Buffer.from([0xff, 0xd8, 0xff]))).toBe('data:image/jpeg;base64,/9j/');
  });
});

describe('buildHlsArgs', () => {
  it('transcodifica RTSP→HLS copiando el vídeo a segmentos rotados', () => {
    const args = buildHlsArgs('rtsp://cam/stream', '/var/hls/cam-1', 'index.m3u8');
    expect(args[args.indexOf('-i') + 1]).toBe('rtsp://cam/stream');
    // Copia el vídeo (sin recodificar) y descarta audio.
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'copy', '-an', '-f', 'hls']));
    // La ventana en vivo borra segmentos viejos (disco acotado).
    expect(args[args.indexOf('-hls_flags') + 1]).toContain('delete_segments');
    expect(args[args.indexOf('-hls_segment_filename') + 1]).toBe('/var/hls/cam-1/seg%d.ts');
    expect(args[args.length - 1]).toBe('/var/hls/cam-1/index.m3u8');
  });

  it('respeta transporte y parámetros de segmento', () => {
    const args = buildHlsArgs('rtsp://cam', '/d', 'p.m3u8', {
      transport: 'udp',
      segmentSeconds: 4,
      listSize: 6,
    });
    expect(args[args.indexOf('-rtsp_transport') + 1]).toBe('udp');
    expect(args[args.indexOf('-hls_time') + 1]).toBe('4');
    expect(args[args.indexOf('-hls_list_size') + 1]).toBe('6');
  });
});
