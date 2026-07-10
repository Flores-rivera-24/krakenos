import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CameraStreamSession } from '@krakenos/types';

/**
 * Coordinador de streaming HLS **bajo demanda** (US-185), compartido por las
 * fuentes `mock` y `rtsp`. Responsabilidades transversales al tipo de cámara:
 *
 * - **Arranque perezoso**: solo transcodifica mientras alguien mira; reutiliza
 *   la sesión si ya existe.
 * - **Límite de concurrencia**: en hardware modesto no se pueden transcodificar
 *   muchos streams a la vez → `STREAM_LIMIT_REACHED`.
 * - **Auto-apagado por inactividad**: `reapIdle()` (barrido periódico) detiene
 *   las sesiones que nadie consume; cada lectura de playlist/segmento la
 *   «toca» para mantenerla viva.
 * - **Anti path-traversal**: los segmentos se sirven por nombre validado dentro
 *   del directorio de la sesión, nunca por ruta arbitraria.
 *
 * El productor real de segmentos (ffmpeg para `rtsp`, un generador sintético
 * para `mock`) es **inyectable** (`StreamSpawner`), así el ciclo de vida se
 * testea sin binarios ni cámaras.
 */

/** Proceso/generador que escribe la playlist y los segmentos en un directorio. */
export interface StreamProcess {
  /** Detiene el proceso y libera recursos. Idempotente. */
  stop(): void | Promise<void>;
}

/** Arranca un productor de segmentos HLS en `outputDir` para una cámara. */
export type StreamSpawner = (input: {
  cameraId: string;
  rtspUrl: string;
  outputDir: string;
}) => StreamProcess;

export interface HlsStreamOptions {
  /** Directorio base; cada cámara tiene su subcarpeta `<baseDir>/<cameraId>`. */
  baseDir: string;
  spawn: StreamSpawner;
  /** Máximo de streams concurrentes (hardware modesto). Por defecto 2. */
  maxConcurrent?: number;
  /** Auto-apagado tras N ms sin actividad. Por defecto 30 s. */
  idleTimeoutMs?: number;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

/** Nombre fijo de la playlist HLS dentro del directorio de cada cámara. */
export const HLS_PLAYLIST_NAME = 'index.m3u8';

/** Segmentos permitidos: `seg0.ts`, `index12.ts`… nunca rutas ni `..`. */
const SEGMENT_RE = /^[A-Za-z0-9_-]+\.ts$/;

/** Se lanza al superar el límite de streams concurrentes. */
export class StreamLimitError extends Error {
  readonly code = 'STREAM_LIMIT_REACHED';
  constructor(readonly limit: number) {
    super(`Se alcanzó el máximo de ${limit} streams simultáneos`);
    this.name = 'StreamLimitError';
  }
}

interface Session {
  proc: StreamProcess;
  dir: string;
  startedAt: number;
  lastActiveAt: number;
}

export class HlsStreamManager {
  private readonly sessions = new Map<string, Session>();
  private readonly maxConcurrent: number;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: HlsStreamOptions) {
    this.maxConcurrent = opts.maxConcurrent ?? 2;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  /** Sesiones activas (para tests / observabilidad). */
  get activeCount(): number {
    return this.sessions.size;
  }

  /**
   * Arranca (o reutiliza) la sesión HLS de una cámara. Lanza `StreamLimitError`
   * si al arrancar una nueva se superaría el límite de concurrencia.
   */
  start(cameraId: string, rtspUrl: string): CameraStreamSession {
    const existing = this.sessions.get(cameraId);
    if (existing) {
      existing.lastActiveAt = this.now();
      return { cameraId, startedAt: new Date(existing.startedAt).toISOString() };
    }
    if (this.sessions.size >= this.maxConcurrent) {
      throw new StreamLimitError(this.maxConcurrent);
    }
    const dir = join(this.opts.baseDir, cameraId);
    // Directorio limpio: descarta segmentos de una sesión anterior mal cerrada.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const proc = this.opts.spawn({ cameraId, rtspUrl, outputDir: dir });
    const startedAt = this.now();
    this.sessions.set(cameraId, { proc, dir, startedAt, lastActiveAt: startedAt });
    return { cameraId, startedAt: new Date(startedAt).toISOString() };
  }

  /** Texto de la playlist vigente, o `null` si no hay sesión o aún sin segmentos. */
  readPlaylist(cameraId: string): string | null {
    const session = this.sessions.get(cameraId);
    if (!session) return null;
    session.lastActiveAt = this.now();
    try {
      return readFileSync(join(session.dir, HLS_PLAYLIST_NAME), 'utf8');
    } catch {
      // ffmpeg aún no escribió la playlist (arranque en curso).
      return null;
    }
  }

  /** Bytes de un segmento por nombre (validado), o `null` si no existe. */
  readSegment(cameraId: string, segment: string): Uint8Array | null {
    const session = this.sessions.get(cameraId);
    if (!session) return null;
    if (!SEGMENT_RE.test(segment)) return null;
    session.lastActiveAt = this.now();
    try {
      return readFileSync(join(session.dir, segment));
    } catch {
      return null;
    }
  }

  /** Detiene la sesión de una cámara y borra sus segmentos (idempotente). */
  async stop(cameraId: string): Promise<void> {
    const session = this.sessions.get(cameraId);
    if (!session) return;
    this.sessions.delete(cameraId);
    try {
      await session.proc.stop();
    } finally {
      rmSync(session.dir, { recursive: true, force: true });
    }
  }

  /** Detiene las sesiones sin actividad reciente. Devuelve cuántas paró. */
  reapIdle(): number {
    const cutoff = this.now() - this.idleTimeoutMs;
    const stale = [...this.sessions.entries()].filter(([, s]) => s.lastActiveAt < cutoff);
    for (const [id] of stale) void this.stop(id);
    return stale.length;
  }

  /** Detiene todas las sesiones (hot-reload/apagado). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
    // Limpia el directorio base por si quedó algún resto.
    if (existsSync(this.opts.baseDir)) {
      rmSync(this.opts.baseDir, { recursive: true, force: true });
    }
  }
}
