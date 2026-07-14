/**
 * Validación por **contenido** de la imagen de fondo de un plano (US-194).
 *
 * La imagen llega como data URL (`data:image/...;base64,...`) ya normalizada en el
 * navegador (reescalada, recomprimida y **sin EXIF/GPS** — la re-codificación por
 * canvas los descarta). El servidor NO confía en el `mime` declarado ni en ninguna
 * extensión: comprueba los **magic bytes** del contenido decodificado. Así una
 * subida con un `mime` mentiroso o un fichero disfrazado se rechaza en el borde.
 *
 * Puro y sin dependencias: testeable con buffers fabricados.
 */

/** MIME de imagen permitidos como fondo de plano. */
export const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

/** ¿Empiezan los bytes por la firma `sig` (a partir de `offset`)? */
function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/** Comprueba los magic bytes de PNG / JPEG / WebP sobre los bytes decodificados. */
export function detectImageMime(bytes: Uint8Array): AllowedImageMime | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // WebP (RIFF): "RIFF" .... "WEBP" (marcador en el offset 8)
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return null;
}

export interface ParsedImageDataUrl {
  mime: string;
  bytes: Uint8Array;
}

/** Extrae `{ mime, bytes }` de un data URL base64 de imagen, o `null` si no lo es. */
export function parseImageDataUrl(dataUrl: string): ParsedImageDataUrl | null {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  try {
    return { mime: m[1]!, bytes: new Uint8Array(Buffer.from(m[2]!, 'base64')) };
  } catch {
    return null;
  }
}

export type ImageValidation =
  | { ok: true; mime: AllowedImageMime }
  | { ok: false; reason: string };

/**
 * Valida una imagen de fondo (data URL). Falla si no es un data URL base64 de
 * imagen, si su MIME declarado no está permitido, o si los magic bytes del
 * contenido no coinciden con un formato permitido (defensa contra el disfraz).
 */
export function validateBackgroundImage(dataUrl: string): ImageValidation {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) return { ok: false, reason: 'No es un data URL de imagen en base64' };
  if (!(ALLOWED_IMAGE_MIMES as readonly string[]).includes(parsed.mime)) {
    return { ok: false, reason: `Formato no permitido: ${parsed.mime}` };
  }
  const detected = detectImageMime(parsed.bytes);
  if (!detected) return { ok: false, reason: 'El contenido no es una imagen PNG, JPEG o WebP' };
  // El contenido manda: el MIME declarado debe coincidir con lo detectado.
  if (detected !== parsed.mime) {
    return { ok: false, reason: `El contenido (${detected}) no coincide con el tipo declarado (${parsed.mime})` };
  }
  return { ok: true, mime: detected };
}
