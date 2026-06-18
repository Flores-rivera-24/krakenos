import { execFile } from 'node:child_process';

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

/** Ejecución real de ffmpeg vía `execFile` (binario del sistema). */
export function createFfmpegExec(ffmpegPath = 'ffmpeg', timeoutMs = 10_000): FfmpegExec {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        ffmpegPath,
        args,
        { encoding: 'buffer', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
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
}
