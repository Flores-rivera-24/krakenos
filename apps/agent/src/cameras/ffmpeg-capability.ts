import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join, win32 } from 'node:path';

/**
 * ¿Hay un `ffmpeg` que ejecutar? (US-280). Un paquete instalado no lo trae, así que las cámaras
 * RTSP —snapshot, HLS— no pueden funcionar hasta que el usuario lo instale. Se **declara** con el
 * paso concreto en vez de que cada petición falle con un «sin señal» que culpa a la cámara.
 *
 * Puro: plataforma, entorno y comprobación de ficheros entran por parámetro.
 */
export interface FfmpegSetupInput {
  /** `FFMPEG_PATH`: una ruta o un nombre suelto (`ffmpeg`) que se busca en el PATH. */
  ffmpegPath: string;
  platform?: NodeJS.Platform;
  /** Cómo está desplegado el agente: en Docker no hay `apt` que valga. */
  deployMode?: string;
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
}

function esRuta(p: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') return win32.isAbsolute(p) || p.includes('\\') || p.includes('/');
  return isAbsolute(p) || p.includes('/');
}

/** `null` si el binario resuelve; si no, el paso que el usuario tiene que dar. */
export function ffmpegSetupStep(input: FfmpegSetupInput): string | null {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const exists = input.exists ?? existsSync;
  const win = platform === 'win32';
  const sep = win ? ';' : delimiter;
  const unir = (dir: string, nombre: string) =>
    win ? `${dir.replace(/[\\/]+$/, '')}\\${nombre}` : join(dir, nombre);

  if (esRuta(input.ffmpegPath, platform)) {
    if (exists(input.ffmpegPath)) return null;
    // Sin la ruta: el mensaje llega a cualquier rol con vídeo (viewer) y la ruta es del servidor.
    return 'No existe el ffmpeg al que apunta FFMPEG_PATH. Corrige la ruta o instala ffmpeg, y reinicia el servicio.';
  }

  const exts = win ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const dirs = (env.PATH ?? env.Path ?? '').split(sep).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      if (exists(unir(dir, `${input.ffmpegPath}${ext}`))) return null;
    }
  }

  if (input.deployMode === 'docker') {
    return 'La imagen de Docker no incluye ffmpeg. Usa Frigate como fuente de cámaras o construye una imagen propia que lo incluya.';
  }
  return win
    ? 'Falta ffmpeg: descarga ffmpeg.exe, ponlo en una carpeta fija y apunta FFMPEG_PATH a esa ruta (o añade la carpeta al PATH del servicio). Después reinicia el servicio: FFMPEG_PATH y el PATH se leen al arrancar.'
    : 'Falta ffmpeg: instálalo (por ejemplo sudo apt install ffmpeg) o apunta FFMPEG_PATH a su ruta, y reinicia el servicio.';
}

/**
 * 503 deliberado con `code` propio: `plugins/error-handler.ts` conserva su mensaje (copy nuestro)
 * y la web lo pinta tal cual.
 */
export class FfmpegRequiresSetupError extends Error {
  readonly statusCode = 503;
  readonly code = 'FFMPEG_REQUIRES_SETUP';

  constructor(step: string) {
    super(`Las cámaras RTSP necesitan ffmpeg y no está disponible. ${step}`);
    this.name = 'FfmpegRequiresSetupError';
  }
}
