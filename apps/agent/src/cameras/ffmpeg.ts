import { execFile, spawn } from 'node:child_process';
import { HLS_PLAYLIST_NAME, type StreamSpawner } from './hls-stream.js';

/**
 * Captura de snapshots RTSP con ffmpeg. El builder de argumentos es **puro** y
 * la ejecución va por un `FfmpegExec` inyectable, de modo que el manager se
 * testea sin el binario ni una cámara real.
 */

export interface FfmpegResult {
  /** Salida estándar (los bytes de la imagen JPEG). */
  stdout: Buffer;
  code: number;
}

/** Ejecuta ffmpeg con unos argumentos y devuelve su salida binaria. Inyectable. */
export type FfmpegExec = (args: string[]) => Promise<FfmpegResult>;

export interface SnapshotArgsOptions {
  /** Transporte RTSP (`tcp` es lo más fiable). */
  transport?: string;
  /** Timeout de lectura/escritura en microsegundos (ffmpeg `-rw_timeout`). */
  timeoutMicros?: number;
}

/**
 * Construye los argumentos de ffmpeg para capturar **un fotograma** del stream
 * RTSP y emitir un JPEG por stdout. Función pura.
 */
export function buildSnapshotArgs(rtspUrl: string, opts: SnapshotArgsOptions = {}): string[] {
  const transport = opts.transport ?? 'tcp';
  const timeout = opts.timeoutMicros ?? 5_000_000;
  return [
    '-nostdin',
    '-rtsp_transport',
    transport,
    '-rw_timeout',
    String(timeout),
    '-i',
    rtspUrl,
    '-frames:v',
    '1',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    '-',
  ];
}

/** Codifica los bytes JPEG como data URL. */
export function jpegToDataUrl(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

/**
 * Construye los argumentos de ffmpeg para capturar **una huella de movimiento**:
 * un fotograma escalado a `w`×`h` en **escala de grises** y emitido como
 * `rawvideo` por stdout (exactamente `w*h` bytes). Función pura (US-186). Es
 * mucho más barato que decodificar la imagen completa: basta para el diff.
 */
export function buildMotionFrameArgs(
  rtspUrl: string,
  w: number,
  h: number,
  opts: SnapshotArgsOptions = {},
): string[] {
  const transport = opts.transport ?? 'tcp';
  const timeout = opts.timeoutMicros ?? 5_000_000;
  return [
    '-nostdin',
    '-rtsp_transport',
    transport,
    '-rw_timeout',
    String(timeout),
    '-i',
    rtspUrl,
    '-frames:v',
    '1',
    '-vf',
    `scale=${w}:${h},format=gray`,
    '-f',
    'rawvideo',
    '-',
  ];
}

export interface HlsArgsOptions {
  /** Transporte RTSP (`tcp` es lo más fiable). */
  transport?: string;
  /** Duración objetivo de cada segmento en segundos. Por defecto 2. */
  segmentSeconds?: number;
  /** Nº de segmentos en la playlist (ventana en vivo). Por defecto 4. */
  listSize?: number;
}

/**
 * Construye los argumentos de ffmpeg para transcodificar un stream RTSP a **HLS
 * en vivo** (US-185): copia el vídeo sin recodificar (`-c:v copy`, barato en CPU
 * de un Pi) y va escribiendo segmentos rotados en `outputDir`, con la playlist
 * en `outputDir/index.m3u8`. Función **pura**. La ventana corta (`delete_segments`)
 * evita que el disco crezca sin fin.
 */
export function buildHlsArgs(
  rtspUrl: string,
  outputDir: string,
  playlistName: string,
  opts: HlsArgsOptions = {},
): string[] {
  const transport = opts.transport ?? 'tcp';
  const segmentSeconds = opts.segmentSeconds ?? 2;
  const listSize = opts.listSize ?? 4;
  return [
    '-nostdin',
    '-rtsp_transport',
    transport,
    '-i',
    rtspUrl,
    // Sin audio (evita problemas de códec) y copiando el vídeo (sin transcodificar).
    '-an',
    '-c:v',
    'copy',
    '-f',
    'hls',
    '-hls_time',
    String(segmentSeconds),
    '-hls_list_size',
    String(listSize),
    // Borra segmentos fuera de la ventana → disco acotado; playlist de tipo evento.
    '-hls_flags',
    'delete_segments+append_list+omit_endlist',
    '-hls_segment_filename',
    `${outputDir}/seg%d.ts`,
    `${outputDir}/${playlistName}`,
  ];
}

/**
 * Crea un `StreamSpawner` que lanza ffmpeg como **proceso de larga duración**
 * (RTSP→HLS, US-185): a diferencia de `createFfmpegExec` (un fotograma y muere),
 * este va escribiendo segmentos hasta que se le mata con `stop()`. Se ignora el
 * `stdout`/`stderr` (los segmentos van a fichero) para no llenar buffers.
 */
export function createFfmpegStreamSpawner(
  ffmpegPath = 'ffmpeg',
  opts: HlsArgsOptions = {},
): StreamSpawner {
  return ({ rtspUrl, outputDir }) => {
    const child = spawn(ffmpegPath, buildHlsArgs(rtspUrl, outputDir, HLS_PLAYLIST_NAME, opts), {
      stdio: 'ignore',
    });
    // Un ffmpeg que muere solo (cámara caída) no debe tumbar el proceso del agente.
    child.on('error', () => {});
    return {
      stop() {
        // SIGKILL directo: ffmpeg puede ignorar SIGTERM mientras espera al stream.
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      },
    };
  };
}

/**
 * Argumentos de ffmpeg para grabar un **clip** de `durationSec` s del stream
 * RTSP a MP4 fragmentado por stdout (US-187). `-c copy` no recodifica (barato);
 * `-movflags frag_keyframe+empty_moov` hace el MP4 escribible a una tubería no
 * buscable. Función pura.
 */
export function buildClipArgs(
  rtspUrl: string,
  durationSec: number,
  opts: SnapshotArgsOptions = {},
): string[] {
  const transport = opts.transport ?? 'tcp';
  return [
    '-nostdin',
    '-rtsp_transport',
    transport,
    '-i',
    rtspUrl,
    '-t',
    String(durationSec),
    '-an',
    '-c:v',
    'copy',
    '-movflags',
    'frag_keyframe+empty_moov',
    '-f',
    'mp4',
    '-',
  ];
}

/**
 * Procesos ffmpeg de un solo disparo (snapshot / fotograma de movimiento / clip)
 * simultáneos. `GET /api/cameras/:id/snapshot` lanza uno por petición y no tenía
 * cota ni rate-limit: 200 peticiones concurrentes desde cualquier rol dejaban 200
 * procesos decodificando RTSP con hasta 16 MB de buffer cada uno, en una máquina
 * cuyo mínimo declarado son 900 MB de RAM (AUD3-07). El streaming HLS ya tenía su
 * propio límite (`maxConcurrent`); esto cierra la otra puerta.
 */
export const FFMPEG_MAX_CONCURRENT = 4;

/** Permisos libres; las peticiones que no caben esperan en `waiters`. */
let ffmpegSlots = FFMPEG_MAX_CONCURRENT;
const ffmpegWaiters: (() => void)[] = [];

/** Reserva un hueco de ejecución (espera si no hay). */
async function acquireFfmpegSlot(): Promise<void> {
  if (ffmpegSlots > 0) {
    ffmpegSlots -= 1;
    return;
  }
  await new Promise<void>((resolve) => ffmpegWaiters.push(resolve));
}

/** Devuelve el hueco y despierta al siguiente en cola. */
function releaseFfmpegSlot(): void {
  const next = ffmpegWaiters.shift();
  if (next) {
    next();
    return;
  }
  ffmpegSlots = Math.min(FFMPEG_MAX_CONCURRENT, ffmpegSlots + 1);
}

/**
 * Ejecución real de ffmpeg vía `execFile` (binario del sistema). `timeoutMs` y
 * `maxBufferBytes` se parametrizan: los snapshots son pequeños y rápidos, pero un
 * **clip** (US-187) dura varios segundos y pesa más → necesita más margen. Todas
 * las ejecuciones comparten el semáforo de arriba.
 */
export function createFfmpegExec(
  ffmpegPath = 'ffmpeg',
  timeoutMs = 10_000,
  maxBufferBytes = 16 * 1024 * 1024,
): FfmpegExec {
  return async (args) => {
    await acquireFfmpegSlot();
    try {
      return await new Promise<FfmpegResult>((resolve) => {
        execFile(
          ffmpegPath,
          args,
          { encoding: 'buffer', timeout: timeoutMs, maxBuffer: maxBufferBytes },
          (err, stdout) => {
            const out = (stdout as Buffer | undefined) ?? Buffer.alloc(0);
            const code =
              err && typeof (err as { code?: unknown }).code === 'number'
                ? (err as { code: number }).code
                : err
                  ? 1
                  : 0;
            resolve({ stdout: out, code });
          },
        );
      });
    } finally {
      releaseFfmpegSlot();
    }
  };
}
