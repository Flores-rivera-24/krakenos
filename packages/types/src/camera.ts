import type { Id, IsoDateTime } from './common.js';

/** Implementaciones de fuente de cámaras disponibles. */
export type CameraKind = 'mock' | 'rtsp';

/** Cámara IP gestionada por el agente (la URL RTSP nunca se expone en la API). */
export interface Camera {
  id: Id;
  name: string;
  room: string | null;
  model: string | null;
  online: boolean;
}

/** Captura puntual de una cámara. */
export interface CameraSnapshot {
  cameraId: Id;
  /** Imagen como data URL (en mock, un SVG; en real, un JPEG del stream). */
  image: string;
  capturedAt: IsoDateTime;
}

/**
 * Sesión de streaming en vivo (HLS) arrancada **bajo demanda** para una cámara
 * (US-185). El transcodificado (RTSP→HLS) solo corre mientras alguien mira; el
 * agente lo detiene por inactividad. La playlist y los segmentos se sirven
 * **autenticados** (token de stream efímero), nunca desde disco público.
 */
export interface CameraStreamSession {
  cameraId: Id;
  /** Momento en que arrancó (o se reutilizó) la sesión. */
  startedAt: IsoDateTime;
}

/**
 * Fuente de cámaras intercambiable. `mock` genera snapshots y una playlist HLS
 * sintéticos; la implementación `rtsp` real transcodifica el stream con ffmpeg
 * (snapshot con un fotograma, vídeo en vivo con RTSP→HLS bajo demanda, US-185).
 */
export interface CameraManager {
  listCameras(): Promise<Camera[]>;
  /** Snapshot de una cámara online, o `null` si no existe o está offline. */
  getSnapshot(id: Id): Promise<CameraSnapshot | null>;
  /**
   * Arranca (o reutiliza) una sesión HLS bajo demanda. Devuelve `null` si la
   * cámara no existe o está offline; **lanza** `STREAM_LIMIT_REACHED` si se
   * supera el máximo de streams concurrentes (hardware modesto).
   */
  startStream(id: Id): Promise<CameraStreamSession | null>;
  /** Detiene la sesión HLS de una cámara (idempotente). */
  stopStream(id: Id): Promise<void>;
  /**
   * Devuelve el texto de la playlist HLS (`.m3u8`) vigente, o `null` si no hay
   * sesión activa o aún no se ha generado ningún segmento. Refresca la actividad
   * de la sesión (evita el auto-apagado por inactividad).
   */
  readStreamPlaylist(id: Id): Promise<string | null>;
  /**
   * Devuelve los bytes de un segmento del stream por nombre, o `null` si no
   * existe. El nombre se valida contra path traversal. Refresca la actividad.
   * (`Uint8Array` y no `Buffer` para no arrastrar los tipos de Node al cliente.)
   */
  readStreamSegment(id: Id, segment: string): Promise<Uint8Array | null>;
  /** Detiene las sesiones ociosas (barrido periódico). Devuelve cuántas paró. */
  reapIdleStreams(): number;
  /** Detiene todas las sesiones y libera recursos (hot-reload/apagado). */
  stop(): Promise<void>;
}

/** Petición para dar de alta una cámara (la `rtspUrl` lleva credenciales). */
export interface CreateCameraRequest {
  name: string;
  /** URL RTSP del stream, p. ej. `rtsp://user:pass@10.0.0.5:554/stream1`. */
  rtspUrl: string;
  room?: string | null;
  model?: string | null;
  enabled?: boolean;
}

/** Campos editables de una cámara (todos opcionales). */
export type UpdateCameraRequest = Partial<CreateCameraRequest>;

/** Vista gestionable de una cámara: **nunca** incluye la `rtspUrl`. */
export interface ManagedCamera {
  id: Id;
  name: string;
  room: string | null;
  model: string | null;
  enabled: boolean;
}
