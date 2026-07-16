import type {
  Camera,
  CameraManager,
  CameraSnapshot,
  CameraStreamSession,
  NativeCameraEvent,
  Recording,
} from '@krakenos/types';
import {
  FRIGATE_RECORDING_PREFIX,
  defaultGo2rtcUrl,
  parseFrigateCameras,
  parseFrigateEvents,
  parseFrigateRecordings,
  rewriteHlsPlaylist,
} from './frigate.parsers.js';

/**
 * Respuesta mínima que necesita el manager; compatible con `fetch`/`safeFetch`.
 */
export interface FrigateResponse {
  ok: boolean;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Transporte HTTP inyectable (el real va por `safeFetch`, política de egress). */
export type FrigateFetch = (url: string) => Promise<FrigateResponse>;

export interface FrigateCameraManagerOptions {
  /** URL base de Frigate (p. ej. `http://frigate.lan:5000`), sin barra final. */
  baseUrl: string;
  /** URL del go2rtc embebido (por defecto: mismo host, puerto 1984). */
  go2rtcUrl?: string;
  fetchImpl: FrigateFetch;
  /** Auto-apagado de sesiones proxy por inactividad, en ms. */
  idleTimeoutMs?: number;
  now?: () => number;
}

interface ProxySession {
  startedAt: string;
  lastActivityMs: number;
  /** Nombre local sintético → URL remota absoluta (nunca sale del servidor). */
  segments: Map<string, string>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
/** Cota del mapa de segmentos por sesión (las playlists live rotan nombres). */
const MAX_SEGMENTS_PER_SESSION = 256;

/**
 * Backend de cámaras **Frigate** (US-214): el NVR delegado del ADR de
 * posicionamiento. KrakenOS no detecta ni graba aquí — Frigate ya lo hace
 * mejor —: lista sus cámaras, sirve snapshot/vídeo/clips por **proxy
 * autenticado** (la URL de Frigate nunca sale al cliente) y consume sus
 * eventos de detección con `label` (person/car/…) vía `pollEvents`.
 * Sin detección propia: `getMotionFrame`/`recordClip` devuelven `null` y el
 * `MotionService` usa el camino nativo. Transporte inyectable (mock-first).
 */
export class FrigateCameraManager implements CameraManager {
  private readonly sessions = new Map<string, ProxySession>();
  private readonly baseUrl: string;
  private readonly go2rtcUrl: string;

  constructor(private readonly opts: FrigateCameraManagerOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.go2rtcUrl = (opts.go2rtcUrl ?? defaultGo2rtcUrl(this.baseUrl)).replace(/\/$/, '');
  }

  private get now(): () => number {
    return this.opts.now ?? Date.now;
  }
  private get idleTimeoutMs(): number {
    return this.opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  private async getText(url: string): Promise<string | null> {
    try {
      const res = await this.opts.fetchImpl(url);
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  private async getBytes(url: string): Promise<Uint8Array | null> {
    try {
      const res = await this.opts.fetchImpl(url);
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }

  async listCameras(): Promise<Camera[]> {
    const raw = await this.getText(`${this.baseUrl}/api/config`);
    return raw ? parseFrigateCameras(raw) : [];
  }

  async getSnapshot(id: string): Promise<CameraSnapshot | null> {
    const cameras = await this.listCameras();
    const camera = cameras.find((c) => c.id === id);
    if (!camera || !camera.online) return null;
    const bytes = await this.getBytes(`${this.baseUrl}/api/${encodeURIComponent(id)}/latest.jpg`);
    if (!bytes) return null;
    return {
      cameraId: id,
      image: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`,
      capturedAt: new Date(this.now()).toISOString(),
    };
  }

  // --- Vídeo en vivo: proxy HLS del go2rtc embebido (modelo de token US-185) ---

  async startStream(id: string): Promise<CameraStreamSession | null> {
    const cameras = await this.listCameras();
    if (!cameras.some((c) => c.id === id && c.online)) return null;
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastActivityMs = this.now();
      return { cameraId: id, startedAt: existing.startedAt };
    }
    const session: ProxySession = {
      startedAt: new Date(this.now()).toISOString(),
      lastActivityMs: this.now(),
      segments: new Map(),
    };
    this.sessions.set(id, session);
    return { cameraId: id, startedAt: session.startedAt };
  }

  async stopStream(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async readStreamPlaylist(id: string): Promise<string | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    const playlistUrl = `${this.go2rtcUrl}/api/stream.m3u8?src=${encodeURIComponent(id)}`;
    const raw = await this.getText(playlistUrl);
    if (raw === null) return null;
    session.lastActivityMs = this.now();
    const { playlist, segments } = rewriteHlsPlaylist(raw, playlistUrl);
    // Fusiona el mapa (los reproductores piden segmentos de playlists previas)
    // con cota: en live los nombres remotos rotan y el mapa no debe crecer solo.
    for (const [name, url] of segments) session.segments.set(name, url);
    while (session.segments.size > MAX_SEGMENTS_PER_SESSION) {
      const oldest = session.segments.keys().next().value;
      if (oldest === undefined) break;
      session.segments.delete(oldest);
    }
    return playlist;
  }

  async readStreamSegment(id: string, segment: string): Promise<Uint8Array | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    // Búsqueda exacta en el mapa: sin disco ni composición de rutas → sin traversal.
    const remote = session.segments.get(segment);
    if (!remote) return null;
    session.lastActivityMs = this.now();
    return this.getBytes(remote);
  }

  reapIdleStreams(): number {
    let reaped = 0;
    for (const [id, session] of this.sessions) {
      if (this.now() - session.lastActivityMs > this.idleTimeoutMs) {
        this.sessions.delete(id);
        reaped++;
      }
    }
    return reaped;
  }

  // --- Detección y grabación: viven en Frigate (no se duplican, US-214) ---

  /** Sin clip local: Frigate ya graba con pre-roll; ver `listNativeRecordings`. */
  async recordClip(): Promise<Uint8Array | null> {
    return null;
  }

  /** Sin frame-diff local: la detección es nativa (`pollEvents`). */
  async getMotionFrame(): Promise<Uint8Array | null> {
    return null;
  }

  async pollEvents(sinceMs: number): Promise<NativeCameraEvent[]> {
    const after = Math.max(0, Math.floor(sinceMs / 1000));
    const raw = await this.getText(`${this.baseUrl}/api/events?after=${after}&limit=100`);
    if (!raw) return [];
    // `after` de Frigate tiene resolución de segundo: se re-filtra fino aquí.
    return parseFrigateEvents(raw).filter((e) => Date.parse(e.detectedAt) > sinceMs);
  }

  async listNativeRecordings(cameraId?: string): Promise<Recording[]> {
    const camera = cameraId ? `&camera=${encodeURIComponent(cameraId)}` : '';
    const raw = await this.getText(`${this.baseUrl}/api/events?has_clip=1&limit=50${camera}`);
    return raw ? parseFrigateRecordings(raw) : [];
  }

  async readNativeRecording(id: string): Promise<Uint8Array | null> {
    if (!id.startsWith(FRIGATE_RECORDING_PREFIX)) return null;
    const eventId = id.slice(FRIGATE_RECORDING_PREFIX.length);
    return this.getBytes(`${this.baseUrl}/api/events/${encodeURIComponent(eventId)}/clip.mp4`);
  }

  async stop(): Promise<void> {
    this.sessions.clear();
  }
}
