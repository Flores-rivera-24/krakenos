import { unzipSync } from 'fflate';

/**
 * Importar el plano de la casa desde una foto, un PDF o un Word .docx (US-194).
 *
 * TODO el trabajo ocurre en el navegador (sin deps de servidor nuevas): el agente
 * solo recibe una **imagen ya normalizada** (data URL). La normalización por canvas
 * reescala, recomprime a WebP y **elimina los metadatos EXIF/GPS** (una foto del
 * móvil no debe guardar tu ubicación) — al redibujar desde píxeles, ninguna cabecera
 * sobrevive.
 *
 * PDF es **best-effort**: extrae la primera imagen rasterizada embebida (el caso
 * común de un plano escaneado). No renderiza PDFs vectoriales/CAD (evitamos pdf.js:
 * su worker ~340 kB reventaría el presupuesto de bundle, US-193); en ese caso se
 * degrada con un aviso honesto.
 *
 * Las funciones **puras** (calibración, selección de imagen docx, extracción de
 * JPEG del PDF) se testean sin DOM; el `normalizeImageBlob` (canvas) es glue fino.
 */

export type PlanImportReason = 'unsupported' | 'pdf-unreadable' | 'docx-no-image' | 'decode-failed';

export class PlanImportError extends Error {
  constructor(readonly reason: PlanImportReason) {
    super(reason);
    this.name = 'PlanImportError';
  }
}

/** Máxima dimensión (px) de la imagen normalizada — acota tamaño/coste. */
export const MAX_PLAN_DIM = 2048;

// ---- Calibración de escala (pura) ----

export interface Calibration {
  widthM: number;
  heightM: number;
}

/**
 * A partir de una línea de referencia trazada sobre la imagen (`refPixels` de
 * largo) que el usuario dice que mide `refMeters`, calcula las dimensiones reales
 * del plano. `imgWpx`/`imgHpx` y `refPixels` deben estar en el MISMO espacio de
 * píxeles (el resultado es invariante a la escala de visualización). Redondea a cm.
 */
export function computeCalibration(
  refPixels: number,
  refMeters: number,
  imgWpx: number,
  imgHpx: number,
): Calibration {
  if (refPixels <= 0 || refMeters <= 0 || imgWpx <= 0 || imgHpx <= 0) {
    throw new Error('Valores de calibración inválidos');
  }
  const scale = refMeters / refPixels; // metros por píxel
  const round = (m: number) => Math.round(m * 100) / 100;
  return { widthM: round(imgWpx * scale), heightM: round(imgHpx * scale) };
}

// ---- Word .docx (puro) ----

/** Elige la imagen embebida más grande de `word/media/` de un .docx descomprimido. */
export function selectLargestMedia(entries: Record<string, Uint8Array>): Uint8Array | null {
  let best: Uint8Array | null = null;
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith('word/media/')) continue;
    if (!/\.(png|jpe?g|webp|bmp|gif)$/i.test(name)) continue;
    if (!best || data.length > best.length) best = data;
  }
  return best;
}

// ---- PDF best-effort (puro): primera imagen JPEG embebida ----

/** Busca el patrón `needle` (ASCII) en `hay` a partir de `from`; -1 si no está. */
function indexOfBytes(hay: Uint8Array, needle: string, from = 0): number {
  const n = needle.length;
  for (let i = from; i <= hay.length - n; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (hay[i + j] !== needle.charCodeAt(j)) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

/**
 * Extrae el flujo de la primera imagen `DCTDecode` (JPEG) embebida en un PDF. Es
 * el formato de un plano escaneado típico: los bytes del flujo **son** un JPEG
 * completo, sin decodificar. Devuelve `null` si no hay ninguna (vectorial/CAD u
 * otros filtros no soportados: el llamante degrada con gracia).
 */
export function extractPdfJpeg(bytes: Uint8Array): Uint8Array | null {
  let cursor = 0;
  // Puede haber varias imágenes; nos quedamos con la primera JPEG válida.
  for (let guard = 0; guard < 64; guard++) {
    const filterAt = indexOfBytes(bytes, 'DCTDecode', cursor);
    if (filterAt < 0) return null;
    const streamAt = indexOfBytes(bytes, 'stream', filterAt);
    if (streamAt < 0) return null;
    // Tras 'stream' viene CRLF o LF antes de los datos binarios.
    let start = streamAt + 'stream'.length;
    if (bytes[start] === 0x0d) start++;
    if (bytes[start] === 0x0a) start++;
    const endAt = indexOfBytes(bytes, 'endstream', start);
    if (endAt < 0) return null;
    let end = endAt;
    // Recorta el EOL que precede a 'endstream'.
    if (bytes[end - 1] === 0x0a) end--;
    if (bytes[end - 1] === 0x0d) end--;
    const stream = bytes.subarray(start, end);
    // Debe empezar por la firma JPEG (FF D8 FF) para ser un JPEG válido.
    if (stream[0] === 0xff && stream[1] === 0xd8 && stream[2] === 0xff) {
      return stream.slice();
    }
    cursor = endAt + 'endstream'.length;
  }
  return null;
}

// ---- Glue DOM: normalización por canvas ----

/**
 * Envuelve bytes en un `Blob` copiándolos a un `ArrayBuffer` propio. Evita el
 * choque de tipos de TS 5.7 (`Uint8Array<ArrayBufferLike>` no es `BlobPart`) y de
 * paso desliga la vista de cualquier buffer compartido/con offset.
 */
function bytesToBlob(bytes: Uint8Array, type?: string): Blob {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy], type ? { type } : undefined);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Reescala a `MAX_PLAN_DIM`, recomprime a WebP y **elimina EXIF/GPS**. Usa
 * `createImageBitmap({imageOrientation:'from-image'})` para respetar la orientación
 * EXIF (un móvil de lado no debe quedar girado). Devuelve un data URL `image/webp`.
 */
export async function normalizeImageBlob(
  blob: Blob,
  maxDim = MAX_PLAN_DIM,
  quality = 0.85,
): Promise<string> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new PlanImportError('decode-failed');
  }
  try {
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PlanImportError('decode-failed');
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', quality));
    if (!out) throw new PlanImportError('decode-failed');
    return await blobToDataUrl(out);
  } finally {
    bmp.close();
  }
}

/**
 * Importa un fichero (imagen / PDF / .docx) y devuelve un data URL de imagen ya
 * normalizado, listo para guardar como fondo del plano. Lanza `PlanImportError`
 * con un motivo cuando el fichero no se puede convertir.
 */
export async function importPlanFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const type = file.type;
  let imageBlob: Blob;

  if (type.startsWith('image/')) {
    imageBlob = file;
  } else if (type === 'application/pdf' || name.endsWith('.pdf')) {
    const jpeg = extractPdfJpeg(new Uint8Array(await file.arrayBuffer()));
    if (!jpeg) throw new PlanImportError('pdf-unreadable');
    imageBlob = bytesToBlob(jpeg, 'image/jpeg');
  } else if (
    name.endsWith('.docx') ||
    type.includes('officedocument.wordprocessingml')
  ) {
    let media: Uint8Array | null = null;
    try {
      media = selectLargestMedia(unzipSync(new Uint8Array(await file.arrayBuffer())));
    } catch {
      throw new PlanImportError('docx-no-image');
    }
    if (!media) throw new PlanImportError('docx-no-image');
    imageBlob = bytesToBlob(media);
  } else {
    throw new PlanImportError('unsupported');
  }

  return normalizeImageBlob(imageBlob);
}
