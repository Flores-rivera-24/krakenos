/**
 * Detección de paredes desde el plano importado de la casa (US-195).
 *
 * TODO ocurre en el navegador y es **puro**: sin ML, sin nube, sin deps. Un plano
 * doméstico es, casi siempre, líneas OSCURAS sobre fondo CLARO y **alineadas a los
 * ejes** (paredes horizontales/verticales). Sobre esa hipótesis, el detector busca
 * tramos maximales de píxeles oscuros por fila (paredes horizontales) y por columna
 * (paredes verticales), fusiona los paralelos casi-solapados (una pared gruesa no
 * debe dar N líneas) y puntúa cada tramo por su continuidad/oscuridad.
 *
 * Las paredes en diagonal se pierden — es una **degradación aceptable**: el usuario
 * confirma/corrige el resultado. El invariante que NO se rompe: **nunca inventar un
 * segmento donde no hay contenido oscuro** (imagen en blanco → `[]`, ruido → `[]`).
 *
 * El resultado sale en coordenadas NORMALIZADAS [0,1] para ser independiente de la
 * resolución del plano. `detectWallsAsync` es idéntico pero cooperativo (cede el
 * event loop cada N filas/columnas), como el heatmap de cobertura.
 */

/** Imagen en escala de grises: un byte de luminancia [0,255] por píxel, row-major. */
export interface GrayImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** Pared detectada, en coordenadas NORMALIZADAS [0,1] (x→derecha, y→abajo). */
export interface DetectedWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
}

export interface WallDetectOptions {
  /** Umbral de "oscuro" [0,255]. Si se omite, se calcula automáticamente (media/Otsu). */
  threshold?: number;
  /** Longitud mínima de un segmento como fracción del lado mayor (default 0.08). */
  minLength?: number;
  /** Confianza mínima [0,1] para incluir un segmento (default 0.4). */
  minConfidence?: number;
}

// ---- Constantes por defecto (afinadas contra los fixtures de test) ----

/** Longitud mínima de un tramo, como fracción del lado mayor. */
const DEFAULT_MIN_LENGTH = 0.08;
/** Confianza mínima para conservar un tramo. */
const DEFAULT_MIN_CONFIDENCE = 0.4;
/** Margen restado a la media al calcular el umbral automático (evita disparar con fondo casi liso). */
const AUTO_THRESHOLD_MARGIN = 30;
/** Huecos claros tolerados dentro de un tramo antes de cortarlo (px). Cubre antialiasing. */
const MAX_GAP = 1;
/** Distancia perpendicular (px) bajo la cual dos tramos paralelos se consideran la misma pared. */
const MERGE_PERP_DIST = 3;
/** Filas/columnas procesadas entre cesiones del event loop en la variante asíncrona. */
const YIELD_EVERY = 64;

// ---- Umbral automático ----

/**
 * Umbral de binarización. Con `opts.threshold` se respeta tal cual; si no, se estima:
 * la media de luminancia menos un margen. En un plano (mayoría de píxeles claros) esto
 * deja por debajo solo la tinta. Un fondo uniforme (todo 255) da un umbral < 0 → nada
 * es "oscuro" → `[]`, que es justo lo que queremos.
 */
function resolveThreshold(img: GrayImage, opts: WallDetectOptions): number {
  if (typeof opts.threshold === 'number') return opts.threshold;
  const { data, width, height } = img;
  const n = width * height;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += data[i] ?? 0;
  const mean = sum / n;
  return mean - AUTO_THRESHOLD_MARGIN;
}

// ---- Extracción de tramos por eje (núcleo puro, compartido sync/async) ----

/** Un tramo maximal de píxeles oscuros a lo largo de una línea (fila o columna). */
interface Run {
  /** Coordenada de la línea (fila `y` para horizontales, columna `x` para verticales). */
  line: number;
  /** Inicio del tramo a lo largo de la línea (inclusive). */
  start: number;
  /** Fin del tramo a lo largo de la línea (inclusive). */
  end: number;
  /** Fracción de píxeles realmente oscuros dentro de [start,end] (continuidad). */
  darkFrac: number;
}

/**
 * Recorre UNA línea (fila o columna) y devuelve sus tramos oscuros maximales que
 * alcancen `minRun` de largo. Tolera huecos claros de hasta `MAX_GAP` (antialiasing)
 * sin partir el tramo, pero solo cuenta como "oscuros" los píxeles bajo umbral para la
 * continuidad. `sample(index)` abstrae el acceso row-major para reusar el mismo código
 * en ambos ejes.
 */
function scanLine(
  lineIndex: number,
  length: number,
  minRun: number,
  threshold: number,
  sample: (along: number) => number,
): Run[] {
  const runs: Run[] = [];
  let start = -1; // inicio del tramo abierto
  let last = -1; // último píxel oscuro visto dentro del tramo
  let darkCount = 0;

  const flush = (endExclusiveDark: number) => {
    if (start < 0) return;
    const end = last; // el tramo termina en el último píxel oscuro real
    const span = end - start + 1;
    if (span >= minRun) {
      runs.push({ line: lineIndex, start, end, darkFrac: darkCount / span });
    }
    start = -1;
    last = -1;
    darkCount = 0;
    void endExclusiveDark;
  };

  for (let a = 0; a < length; a++) {
    const dark = sample(a) < threshold;
    if (dark) {
      if (start < 0) start = a;
      last = a;
      darkCount++;
    } else if (start >= 0 && a - last > MAX_GAP) {
      // Hueco claro mayor que el tolerado → cierra el tramo actual.
      flush(a);
    }
  }
  flush(length);
  return runs;
}

/**
 * Fusiona tramos casi-duplicados de un mismo eje: paralelos a ≤ `MERGE_PERP_DIST`
 * píxeles y con solape en el rango a lo largo de la línea → una sola pared (la de
 * mayor `darkFrac`, absorbiendo la extensión de ambos). Evita que una pared gruesa
 * (varias filas/columnas adyacentes) produzca líneas repetidas.
 */
function mergeRuns(runs: Run[]): Run[] {
  const merged: Run[] = [];
  // Ordena por línea y luego por inicio para que los candidatos a fusión sean vecinos.
  const sorted = [...runs].sort((a, b) => a.line - b.line || a.start - b.start);

  for (const run of sorted) {
    let absorbed = false;
    for (let i = 0; i < merged.length; i++) {
      const m = merged[i];
      if (!m) continue;
      const near = Math.abs(m.line - run.line) <= MERGE_PERP_DIST;
      const overlap = run.start <= m.end && m.start <= run.end;
      if (near && overlap) {
        // Misma pared: extiende el rango y conserva la línea/darkFrac del más fuerte.
        const start = Math.min(m.start, run.start);
        const end = Math.max(m.end, run.end);
        const strongest = run.darkFrac > m.darkFrac ? run : m;
        merged[i] = { line: strongest.line, start, end, darkFrac: strongest.darkFrac };
        absorbed = true;
        break;
      }
    }
    if (!absorbed) merged.push({ ...run });
  }
  return merged;
}

/**
 * Confianza [0,1] de un tramo: combina su continuidad (fracción de píxeles oscuros)
 * con su largo relativo al lado mayor. Un tramo largo y sólido puntúa alto; uno corto
 * o entrecortado, bajo.
 */
function runConfidence(run: Run, maxSide: number): number {
  const span = run.end - run.start + 1;
  const lengthScore = Math.min(1, span / maxSide);
  // Pondera continuidad (peso principal) y algo de largo, y limita a [0,1].
  const conf = run.darkFrac * 0.7 + lengthScore * 0.3;
  return Math.max(0, Math.min(1, conf));
}

/** Parámetros derivados de las opciones, compartidos por ambas variantes. */
interface Resolved {
  threshold: number;
  minRun: number;
  minConfidence: number;
  maxSide: number;
}

function resolveParams(img: GrayImage, opts: WallDetectOptions): Resolved {
  const maxSide = Math.max(img.width, img.height);
  const minLength = opts.minLength ?? DEFAULT_MIN_LENGTH;
  return {
    threshold: resolveThreshold(img, opts),
    minRun: Math.max(2, Math.ceil(minLength * maxSide)),
    minConfidence: opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
    maxSide,
  };
}

/** Convierte un tramo horizontal (fila `line`, x∈[start,end]) a pared normalizada. */
function horizontalToWall(run: Run, img: GrayImage, conf: number): DetectedWall {
  const y = (run.line + 0.5) / img.height;
  return {
    x1: run.start / img.width,
    y1: y,
    x2: (run.end + 1) / img.width,
    y2: y,
    confidence: conf,
  };
}

/** Convierte un tramo vertical (columna `line`, y∈[start,end]) a pared normalizada. */
function verticalToWall(run: Run, img: GrayImage, conf: number): DetectedWall {
  const x = (run.line + 0.5) / img.width;
  return {
    x1: x,
    y1: run.start / img.height,
    x2: x,
    y2: (run.end + 1) / img.height,
    confidence: conf,
  };
}

/** Filtra por confianza y mapea tramos ya fusionados a paredes normalizadas. */
function toWalls(
  runs: Run[],
  img: GrayImage,
  p: Resolved,
  toWall: (run: Run, img: GrayImage, conf: number) => DetectedWall,
): DetectedWall[] {
  const out: DetectedWall[] = [];
  for (const run of runs) {
    const conf = runConfidence(run, p.maxSide);
    if (conf >= p.minConfidence) out.push(toWall(run, img, conf));
  }
  return out;
}

// ---- API pública ----

/**
 * Detecta paredes alineadas a los ejes en un plano en escala de grises. Síncrono:
 * apto para imágenes moderadas. Para planos grandes, `detectWallsAsync` no congela el
 * loop. Ambos producen resultados IDÉNTICOS.
 */
export function detectWalls(img: GrayImage, opts: WallDetectOptions = {}): DetectedWall[] {
  const { data, width, height } = img;
  if (width <= 0 || height <= 0) return [];
  const p = resolveParams(img, opts);

  // Horizontales: recorre cada fila.
  const hRuns: Run[] = [];
  for (let y = 0; y < height; y++) {
    const base = y * width;
    const found = scanLine(y, width, p.minRun, p.threshold, (x) => data[base + x] ?? 255);
    for (const r of found) hRuns.push(r);
  }

  // Verticales: recorre cada columna.
  const vRuns: Run[] = [];
  for (let x = 0; x < width; x++) {
    const found = scanLine(x, height, p.minRun, p.threshold, (y) => data[y * width + x] ?? 255);
    for (const r of found) vRuns.push(r);
  }

  return [
    ...toWalls(mergeRuns(hRuns), img, p, horizontalToWall),
    ...toWalls(mergeRuns(vRuns), img, p, verticalToWall),
  ];
}

/**
 * Igual que `detectWalls` pero COOPERATIVO: cede el event loop cada `YIELD_EVERY`
 * filas/columnas para no bloquear la UI en planos grandes. Reusa exactamente los
 * mismos helpers, así que el resultado es idéntico al síncrono.
 */
export async function detectWallsAsync(
  img: GrayImage,
  opts: WallDetectOptions = {},
): Promise<DetectedWall[]> {
  const { data, width, height } = img;
  if (width <= 0 || height <= 0) return [];
  const p = resolveParams(img, opts);
  const yield0 = () => new Promise<void>((r) => setTimeout(r, 0));

  const hRuns: Run[] = [];
  for (let y = 0; y < height; y++) {
    const base = y * width;
    const found = scanLine(y, width, p.minRun, p.threshold, (x) => data[base + x] ?? 255);
    for (const r of found) hRuns.push(r);
    if (y % YIELD_EVERY === YIELD_EVERY - 1) await yield0();
  }

  const vRuns: Run[] = [];
  for (let x = 0; x < width; x++) {
    const found = scanLine(x, height, p.minRun, p.threshold, (y) => data[y * width + x] ?? 255);
    for (const r of found) vRuns.push(r);
    if (x % YIELD_EVERY === YIELD_EVERY - 1) await yield0();
  }

  return [
    ...toWalls(mergeRuns(hRuns), img, p, horizontalToWall),
    ...toWalls(mergeRuns(vRuns), img, p, verticalToWall),
  ];
}
