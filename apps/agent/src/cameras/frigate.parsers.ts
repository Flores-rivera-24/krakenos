import type { Camera, NativeCameraEvent, Recording } from '@krakenos/types';

/**
 * Parsers **puros** del backend Frigate (US-214). Frigate es el NVR delegado
 * del ADR de posicionamiento: detección de objetos por ML (person/car/…),
 * pre-roll y grabación viven allí; KrakenOS lista, avisa y sirve por proxy.
 * Todo defensivo: un JSON corrupto o con campos ausentes degrada a vacío.
 */

/** Prefijo de los ids de grabación nativa (los distingue de los clips locales). */
export const FRIGATE_RECORDING_PREFIX = 'frg-';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** `GET /api/config` → cámaras configuradas en Frigate. */
export function parseFrigateCameras(raw: string): Camera[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const cameras = asRecord(asRecord(data).cameras);
  return Object.entries(cameras).map(([name, cfg]) => ({
    id: name,
    name,
    room: null,
    model: null,
    // Frigate no expone salud por cámara en /config: honesto = habilitada.
    online: asRecord(cfg).enabled !== false,
  }));
}

interface RawFrigateEvent {
  id?: unknown;
  camera?: unknown;
  label?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  has_clip?: unknown;
  thumbnail?: unknown;
}

function eventTime(epochSeconds: unknown): string | null {
  const n = Number(epochSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Math.round(n * 1000)).toISOString();
}

function thumbnailDataUrl(thumbnail: unknown): string | null {
  return typeof thumbnail === 'string' && thumbnail.length > 0
    ? `data:image/jpeg;base64,${thumbnail}`
    : null;
}

/** `GET /api/events` → eventos de detección con su `label` y miniatura. */
export function parseFrigateEvents(raw: string): NativeCameraEvent[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: NativeCameraEvent[] = [];
  for (const item of data) {
    const e = item as RawFrigateEvent;
    const detectedAt = eventTime(e.start_time);
    if (typeof e.camera !== 'string' || typeof e.label !== 'string' || !detectedAt) continue;
    out.push({
      cameraId: e.camera,
      cameraName: e.camera,
      detectedAt,
      label: e.label,
      snapshot: thumbnailDataUrl(e.thumbnail),
    });
  }
  return out;
}

/**
 * `GET /api/events?has_clip=1` → grabaciones nativas (timeline US-187). El id
 * lleva prefijo `frg-` y la descarga va por proxy: **ninguna URL de Frigate
 * sale al cliente**. `sizeBytes` es 0 (Frigate no lo expone en la lista).
 */
export function parseFrigateRecordings(raw: string): Recording[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Recording[] = [];
  for (const item of data) {
    const e = item as RawFrigateEvent;
    const startedAt = eventTime(e.start_time);
    if (typeof e.id !== 'string' || typeof e.camera !== 'string' || !startedAt) continue;
    if (e.has_clip === false) continue;
    const start = Number(e.start_time);
    const end = Number(e.end_time);
    const durationSec =
      Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round(end - start) : 0;
    out.push({
      id: `${FRIGATE_RECORDING_PREFIX}${e.id}`,
      cameraId: e.camera,
      cameraName: typeof e.label === 'string' ? `${e.camera} (${e.label})` : e.camera,
      startedAt,
      durationSec,
      sizeBytes: 0,
      snapshot: thumbnailDataUrl(e.thumbnail),
    });
  }
  return out;
}

/** Extensiones de segmento HLS que el proxy acepta y sabe servir. */
const SEGMENT_EXTENSIONS = ['ts', 'm4s', 'mp4'] as const;

export interface RewrittenPlaylist {
  playlist: string;
  /** Nombre local seguro → URL remota absoluta (solo vive en el servidor). */
  segments: Map<string, string>;
}

function segmentExtension(uri: string): string {
  const path = uri.split('?')[0] ?? '';
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return (SEGMENT_EXTENSIONS as readonly string[]).includes(ext) ? ext : 'ts';
}

/**
 * Reescribe una playlist HLS remota (go2rtc) sustituyendo cada URI por un
 * **nombre local sintético** (`f<n>.<ext>`) y devolviendo el mapa nombre→URL
 * remota absoluta. Puro. Así: (1) la URL de Frigate/go2rtc **nunca** llega al
 * cliente, y (2) no hay path traversal posible — el segmento se sirve por
 * búsqueda exacta en el mapa, no tocando disco ni componiendo rutas.
 * Cubre las líneas de URI y el atributo `URI="…"` de `#EXT-X-MAP`/`#EXT-X-KEY`.
 */
export function rewriteHlsPlaylist(playlistText: string, playlistUrl: string): RewrittenPlaylist {
  const segments = new Map<string, string>();
  let counter = 0;
  const localNameFor = (uri: string): string => {
    const absolute = new URL(uri, playlistUrl).toString();
    for (const [name, url] of segments) if (url === absolute) return name;
    const name = `f${counter++}.${segmentExtension(uri)}`;
    segments.set(name, absolute);
    return name;
  };

  const lines = playlistText.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      // Los tags con URI embebida (mapa de init MP4, claves) también se proxyean.
      return line.replace(/URI="([^"]+)"/, (_m, uri: string) => `URI="${localNameFor(uri)}"`);
    }
    return localNameFor(trimmed);
  });

  return { playlist: lines.join('\n'), segments };
}

/** Content-Type de un segmento del proxy según su extensión sintética. */
export function segmentContentType(name: string): string {
  if (name.endsWith('.m4s') || name.endsWith('.mp4')) return 'video/mp4';
  return 'video/mp2t';
}

/** URL por defecto del go2rtc embebido: mismo host que Frigate, puerto 1984. */
export function defaultGo2rtcUrl(frigateBaseUrl: string): string {
  try {
    const url = new URL(frigateBaseUrl);
    url.port = '1984';
    url.pathname = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return frigateBaseUrl;
  }
}
