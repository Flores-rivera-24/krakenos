import { detectWallsAsync, type GrayImage } from '@/lib/wall-detect';

/**
 * Puente entre el detector puro de paredes (US-195, `wall-detect.ts`) y el editor
 * de cobertura: extrae los píxeles en gris de la imagen de fondo (glue DOM, canvas)
 * y convierte los segmentos detectados (normalizados) a **metros** del plano.
 *
 * El detector nunca ve el DOM; aquí está toda la parte no-testeable-en-jsdom
 * (canvas/getImageData). El cómputo pesado va por la variante cooperativa
 * (`detectWallsAsync`) para no congelar la UI en imágenes grandes.
 */

/** Pared propuesta en coordenadas del plano (metros) + confianza [0,1]. */
export interface ProposedWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

/** Dimensión máxima (px) a la que se reduce la imagen para detectar (coste acotado). */
const DETECT_MAX_DIM = 1024;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen del plano'));
    img.src = dataUrl;
  });
}

/** Rasteriza la imagen a escala de grises (luminancia por píxel), reducida. */
async function imageToGray(dataUrl: string): Promise<GrayImage> {
  const img = await loadImage(dataUrl);
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  const scale = Math.min(1, DETECT_MAX_DIM / Math.max(natW, natH));
  const width = Math.max(1, Math.round(natW * scale));
  const height = Math.max(1, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la imagen');
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    // Luminancia Rec. 601 (entera, sin coma flotante costosa).
    gray[i] = (data[p]! * 77 + data[p + 1]! * 150 + data[p + 2]! * 29) >> 8;
  }
  return { data: gray, width, height };
}

/**
 * Detecta paredes candidatas sobre la imagen de fondo del plano y las devuelve en
 * metros. Coordenadas del plano: metros, origen arriba-izquierda (como el modelo).
 */
export async function proposeWalls(
  dataUrl: string,
  widthM: number,
  heightM: number,
): Promise<ProposedWall[]> {
  const gray = await imageToGray(dataUrl);
  const detected = await detectWallsAsync(gray);
  // Normalizado [0,1] → metros del plano.
  return detected.map((w) => ({
    x1: w.x1 * widthM,
    y1: w.y1 * heightM,
    x2: w.x2 * widthM,
    y2: w.y2 * heightM,
    confidence: w.confidence,
  }));
}
