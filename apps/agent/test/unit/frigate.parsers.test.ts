import { describe, expect, it } from 'vitest';
import {
  defaultGo2rtcUrl,
  parseFrigateCameras,
  parseFrigateEvents,
  parseFrigateRecordings,
  rewriteHlsPlaylist,
  segmentContentType,
} from '../../src/cameras/frigate.parsers.js';

const CONFIG = JSON.stringify({
  cameras: { entrada: { enabled: true }, patio: { enabled: false }, salon: {} },
});

const EVENTS = JSON.stringify([
  {
    id: '1700000100.5-abc',
    camera: 'entrada',
    label: 'person',
    start_time: 1700000100.5,
    end_time: 1700000110.5,
    has_clip: true,
    thumbnail: 'AAAA',
  },
  { id: 'sin-camara', label: 'car', start_time: 1700000000 },
  { id: '1700000200-def', camera: 'patio', label: 'cat', start_time: 1700000200, has_clip: false },
]);

describe('parseFrigateCameras', () => {
  it('mapea las cámaras del /api/config (enabled !== false → online)', () => {
    const cameras = parseFrigateCameras(CONFIG);
    expect(cameras.map((c) => ({ id: c.id, online: c.online }))).toEqual([
      { id: 'entrada', online: true },
      { id: 'patio', online: false },
      { id: 'salon', online: true },
    ]);
  });

  it('JSON corrupto o sin cameras → []', () => {
    expect(parseFrigateCameras('{{{')).toEqual([]);
    expect(parseFrigateCameras('{}')).toEqual([]);
  });
});

describe('parseFrigateEvents', () => {
  it('mapea eventos con label y miniatura; omite los que no tienen cámara', () => {
    const events = parseFrigateEvents(EVENTS);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      cameraId: 'entrada',
      cameraName: 'entrada',
      detectedAt: new Date(1700000100500).toISOString(),
      label: 'person',
      snapshot: 'data:image/jpeg;base64,AAAA',
    });
    expect(events[1]!.snapshot).toBeNull();
  });

  it('corrupto → []', () => {
    expect(parseFrigateEvents('nope')).toEqual([]);
    expect(parseFrigateEvents('{}')).toEqual([]);
  });
});

describe('parseFrigateRecordings', () => {
  it('mapea eventos con clip a Recording con id prefijado; omite has_clip:false', () => {
    const recordings = parseFrigateRecordings(EVENTS);
    expect(recordings).toHaveLength(1);
    expect(recordings[0]).toMatchObject({
      id: 'frg-1700000100.5-abc',
      cameraId: 'entrada',
      durationSec: 10,
      snapshot: 'data:image/jpeg;base64,AAAA',
    });
  });
});

describe('rewriteHlsPlaylist (proxy sin fuga, US-214)', () => {
  const PLAYLIST = [
    '#EXTM3U',
    '#EXT-X-MAP:URI="init.mp4?src=entrada"',
    '#EXTINF:2.0,',
    'segment0.m4s?src=entrada&n=0',
    '#EXTINF:2.0,',
    'https://frigate.lan:1984/abs/segment1.ts',
    '',
  ].join('\n');
  const URL_BASE = 'http://frigate.lan:1984/api/stream.m3u8?src=entrada';

  it('sustituye cada URI por un nombre sintético y guarda el mapa absoluto', () => {
    const { playlist, segments } = rewriteHlsPlaylist(PLAYLIST, URL_BASE);
    // La URL del NVR no aparece por ninguna parte en lo que ve el cliente.
    expect(playlist).not.toContain('frigate.lan');
    expect(playlist).not.toContain('src=entrada');
    expect(playlist).toContain('URI="f0.mp4"');
    expect(playlist).toContain('f1.m4s');
    expect(playlist).toContain('f2.ts');
    expect(segments.get('f0.mp4')).toBe('http://frigate.lan:1984/api/init.mp4?src=entrada');
    expect(segments.get('f1.m4s')).toBe(
      'http://frigate.lan:1984/api/segment0.m4s?src=entrada&n=0',
    );
    expect(segments.get('f2.ts')).toBe('https://frigate.lan:1984/abs/segment1.ts');
  });

  it('la misma URI repetida reusa el mismo nombre (mapa estable)', () => {
    const twice = 'a.ts\na.ts\n';
    const { segments } = rewriteHlsPlaylist(twice, URL_BASE);
    expect(segments.size).toBe(1);
  });
});

describe('segmentContentType + defaultGo2rtcUrl', () => {
  it('elige el content-type por extensión', () => {
    expect(segmentContentType('f0.ts')).toBe('video/mp2t');
    expect(segmentContentType('f1.m4s')).toBe('video/mp4');
    expect(segmentContentType('f2.mp4')).toBe('video/mp4');
  });

  it('deriva el go2rtc del host de Frigate en el puerto 1984', () => {
    expect(defaultGo2rtcUrl('http://frigate.lan:5000')).toBe('http://frigate.lan:1984');
    expect(defaultGo2rtcUrl('no-es-url')).toBe('no-es-url');
  });
});
