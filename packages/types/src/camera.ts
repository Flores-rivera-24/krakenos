import type { Id, IsoDateTime } from './common.js';

/** Implementaciones de fuente de cámaras disponibles. */
export type CameraKind = 'mock' | 'rtsp' | 'frigate';

/**
 * Evento de detección **nativo** de un backend con detección propia (Frigate,
 * US-214): en vez del frame-diff local (US-186), el backend ya sabe QUÉ vio.
 * `label` es el objeto detectado (`person`/`car`/`dog`/…, vocabulario del
 * backend); `snapshot` es la miniatura del evento como data URL, si la hay.
 */
export interface NativeCameraEvent {
  cameraId: Id;
  cameraName: string;
  detectedAt: IsoDateTime;
  label: string;
  snapshot: string | null;
}

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
  /**
   * Graba un clip de ~`durationSec` segundos de la cámara y devuelve sus bytes
   * (contenedor MP4), o `null` si la cámara no existe/offline o falla la captura
   * (US-187). En `rtsp` copia el stream sin recodificar; en `mock` genera un
   * clip sintético. El servicio de grabación lo escribe a disco.
   */
  recordClip(id: Id, durationSec: number): Promise<Uint8Array | null>;
  /**
   * Fotograma reducido en **escala de grises** (rejilla fija, ver
   * `MOTION_FRAME_WIDTH`×`MOTION_FRAME_HEIGHT`) para la detección de movimiento por
   * diferencia de fotogramas (US-186). `null` si la cámara no existe/offline o no
   * se pudo capturar. Es una huella barata (sin decodificar la imagen completa):
   * ffmpeg escala a gris con `scale=w:h,format=gray`.
   */
  getMotionFrame(id: Id): Promise<Uint8Array | null>;
  /** Detiene todas las sesiones y libera recursos (hot-reload/apagado). */
  stop(): Promise<void>;
  /**
   * Detección **nativa** (US-214): eventos nuevos desde `sinceMs` (epoch). Solo
   * la implementan los backends con detección propia (Frigate) — su presencia
   * hace que el `MotionService` NO aplique el frame-diff local (la detección
   * vive en el backend; no se duplica) y sondee esto en su lugar.
   */
  pollEvents?(sinceMs: number): Promise<NativeCameraEvent[]>;
  /**
   * Grabaciones **nativas** del backend (US-214): clips que viven en el NVR
   * (Frigate), listados por proxy — la URL del backend nunca sale al cliente.
   * Su presencia hace que las rutas de grabaciones sirvan esta lista en vez de
   * la local (`RecordingService` no graba: el NVR ya lo hace, no se duplica).
   */
  listNativeRecordings?(cameraId?: Id): Promise<Recording[]>;
  /** Bytes MP4 de una grabación nativa por id, o `null` si no existe. */
  readNativeRecording?(id: Id): Promise<Uint8Array | null>;
}

/** Ancho/alto de la huella de movimiento (rejilla fija, barata de comparar). */
export const MOTION_FRAME_WIDTH = 32;
export const MOTION_FRAME_HEIGHT = 24;

/** Sensibilidad de la detección de movimiento (US-186). */
export type MotionSensitivity = 'low' | 'medium' | 'high';
export const MOTION_SENSITIVITIES = ['low', 'medium', 'high'] as const;

/**
 * Ventana de armado (US-186): la cámara solo vigila dentro de estas franjas. Los
 * minutos son desde medianoche; si `fromMinute > toMinute` la franja cruza
 * medianoche (p. ej. 22:00→07:00). `days` (0-6, Dom-Sáb) ausente = todos.
 */
export interface MotionArmWindow {
  days?: number[];
  fromMinute: number;
  toMinute: number;
}

/**
 * Modo de armado de una cámara: siempre vigila, nunca, o solo en ventanas.
 * `schedule` con `windows` vacío ≡ nunca armada.
 */
export type MotionArming =
  | { mode: 'always' }
  | { mode: 'never' }
  | { mode: 'schedule'; windows: MotionArmWindow[] };

/** Configuración de detección de movimiento por cámara (US-186). */
export interface MotionConfig {
  enabled: boolean;
  sensitivity: MotionSensitivity;
  /** Segundos mínimos entre avisos de la misma cámara (anti-ráfaga). */
  cooldownSec: number;
  arming: MotionArming;
  /** Grabar un clip al detectar movimiento (US-187). */
  record: boolean;
}

/** Config de movimiento efectiva de una cámara (incluye su id). */
export interface CameraMotionConfig extends MotionConfig {
  cameraId: Id;
}

/** Cambios de la config de movimiento (`PUT /api/cameras/:id/motion`). */
export interface UpdateMotionConfigRequest {
  enabled?: boolean;
  sensitivity?: MotionSensitivity;
  cooldownSec?: number;
  arming?: MotionArming;
  record?: boolean;
}

/**
 * Evento de movimiento detectado (US-186): incluye un snapshot para el aviso y
 * la línea de tiempo (US-187). El snapshot es una data URL (JPEG en real).
 */
export interface MotionEvent {
  cameraId: Id;
  cameraName: string;
  detectedAt: IsoDateTime;
  /** Snapshot capturado en el momento del disparo (data URL), o `null`. */
  snapshot: string | null;
  /** Objeto detectado (`person`/`car`/…) si la detección es nativa (US-214). */
  label?: string | null;
}

/**
 * Clip grabado por un evento de movimiento (US-187). La **ruta en disco nunca se
 * expone** en la API (como la `rtspUrl`): la descarga va por `id`. `snapshot` es
 * la miniatura del timeline.
 */
export interface Recording {
  id: Id;
  cameraId: Id;
  cameraName: string;
  startedAt: IsoDateTime;
  durationSec: number;
  sizeBytes: number;
  snapshot: string | null;
}

/** Config de grabación por evento del hogar (US-187). */
export interface RecordingConfig {
  /** Días de retención de los clips (además del tope por tamaño). */
  retentionDays: number;
  /** Tope de tamaño total de todos los clips, en MB. */
  maxTotalMb: number;
  /** Duración de cada clip, en segundos. */
  clipSeconds: number;
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
