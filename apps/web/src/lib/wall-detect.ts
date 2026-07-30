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
  /**
   * Umbral fijo de "oscuro" [0,255]. Si se omite —lo normal— se usa un umbral
   * **local adaptativo** (Sauvola), que es lo que aguanta sombras y viñeteado.
   */
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
/** Huecos claros tolerados dentro de un tramo antes de cortarlo (px). Cubre antialiasing. */
const MAX_GAP = 1;
/** Distancia perpendicular (px) bajo la cual dos tramos paralelos son la misma pared. */
const MERGE_PERP_DIST = 3;
/**
 * Relación largo/grosor mínima para considerar que una banda es una pared. Por
 * debajo es una mancha (o la sección transversal de un muro macizo, que el barrido
 * del eje perpendicular también encuentra).
 */
const MIN_ASPECT_RATIO = 3;

// ---- Umbral local adaptativo (Sauvola por bloques) ----

/**
 * Sensibilidad de Sauvola. Cuanto mayor, más exigente (menos tinta). 0,34 es el
 * valor habitual para texto/línea sobre papel.
 */
const SAUVOLA_K = 0.34;
/** Rango dinámico de referencia de la desviación típica (mitad de 0-255). */
const SAUVOLA_R = 128;
/** Divisor del lado mayor para el tamaño de bloque del umbral. */
const THRESHOLD_BLOCK_DIVISOR = 24;
/** Bloque mínimo, para que un plano pequeño no acabe con bloques de 2 px. */
const MIN_THRESHOLD_BLOCK = 16;
/**
 * Desviación típica por debajo de la cual un bloque se considera **sin contraste**:
 * no puede decidir por sí mismo y hereda el umbral de la escala gruesa.
 */
const MIN_LOCAL_STD = 8;
/** Cuántas veces mayor es el bloque de la escala gruesa. */
const COARSE_FACTOR = 4;

/**
 * Mapa de umbral local, en una rejilla gruesa de bloques.
 *
 * Se calcula por **bloques** y no por píxel a propósito: el campo de umbral es
 * suave (es una media local), así que una rejilla gruesa + interpolación bilineal
 * da el mismo resultado que Sauvola por píxel sin las **dos imágenes integrales**
 * que este haría falta —64 MB para un plano de 2048², en el navegador y a menudo
 * en un móvil—.
 */
interface ThresholdField {
  values: Float64Array;
  cols: number;
  rows: number;
  block: number;
}
/** Filas/columnas procesadas entre cesiones del event loop en la variante asíncrona. */
const YIELD_EVERY = 64;

// ---- Umbral automático ----

/**
 * Construye el campo de umbral **local** (Sauvola por bloques):
 * `T = m · (1 + k · (s/R − 1))`, con `m` y `s` la media y la desviación típica del
 * bloque. Un píxel es tinta si es más oscuro que **su entorno**, no que la imagen
 * entera.
 *
 * ⚠️ **Por qué el umbral global no valía** (AUD3-35): era `media − 30` sobre toda la
 * imagen. En una foto de móvil con sombra o viñeteado, media plancha del plano cae
 * por debajo de esa media y **se convierte en tinta**: 5 paredes pasaban a 311. Y
 * cada pared falsa **cobra atenuación** en el modelo RF (`wallLossAlong` suma cada
 * pared cruzada, que es lo correcto para paredes de verdad), así que el mapa
 * declaraba zonas muertas donde no las había.
 *
 * Propiedades que se conservan (y que los tests fijan):
 * - **Fondo uniforme → `[]`**: con `s = 0`, `T = m·(1−k) = 0,66·m`, y ningún píxel
 *   de valor `m` es menor que `0,66·m`. Nunca se inventa tinta donde no hay contraste.
 * - **Ruido → `[]`**: el ruido sube `s` y baja el umbral, y los píxeles sueltos que
 *   pasen no forman tramos de la longitud mínima.
 */
/** Media, desviación típica y umbral de Sauvola de cada bloque de tamaño `block`. */
function statsPorBloque(img: GrayImage, block: number): { mean: Float64Array; std: Float64Array; cols: number; rows: number } {
  const { data, width, height } = img;
  const cols = Math.max(1, Math.ceil(width / block));
  const rows = Math.max(1, Math.ceil(height / block));
  const mean = new Float64Array(cols * rows);
  const std = new Float64Array(cols * rows);

  for (let by = 0; by < rows; by++) {
    const y0 = by * block;
    const y1 = Math.min(height, y0 + block);
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * block;
      const x1 = Math.min(width, x0 + block);
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        const base = y * width;
        for (let x = x0; x < x1; x++) {
          const v = data[base + x] ?? 255;
          sum += v;
          sumSq += v * v;
          n++;
        }
      }
      const i = by * cols + bx;
      if (n === 0) continue;
      const m = sum / n;
      mean[i] = m;
      // `max(0, …)` porque el redondeo puede dar una varianza negativa minúscula.
      std[i] = Math.sqrt(Math.max(0, sumSq / n - m * m));
    }
  }
  return { mean, std, cols, rows };
}

/** Umbral de Sauvola a partir de la media y la desviación típica de un bloque. */
function sauvola(mean: number, std: number): number {
  return mean * (1 + SAUVOLA_K * (std / SAUVOLA_R - 1));
}

function buildThresholdField(img: GrayImage): ThresholdField {
  const maxSide = Math.max(img.width, img.height);
  const block = Math.max(MIN_THRESHOLD_BLOCK, Math.round(maxSide / THRESHOLD_BLOCK_DIVISOR));
  const fina = statsPorBloque(img, block);
  const gruesa = statsPorBloque(img, block * COARSE_FACTOR);
  const values = new Float64Array(fina.cols * fina.rows);

  for (let by = 0; by < fina.rows; by++) {
    for (let bx = 0; bx < fina.cols; bx++) {
      const i = by * fina.cols + bx;
      const m = fina.mean[i] ?? 0;
      const sd = fina.std[i] ?? 0;
      if (sd >= MIN_LOCAL_STD) {
        values[i] = sauvola(m, sd);
        continue;
      }
      // ⚠️ Bloque SIN contraste: o es todo fondo, o es el interior de un muro
      // macizo. Sauvola por sí solo elige mal el segundo caso —el umbral baja
      // hasta por debajo de la propia tinta y el muro se **ahueca** por dentro,
      // partiéndose en dos paredes con un hueco falso—. Sin contraste local no
      // hay información para decidir: se pregunta a una ventana más grande, que
      // sí ve el fondo.
      const gx = Math.min(gruesa.cols - 1, Math.floor((bx * block) / (block * COARSE_FACTOR)));
      const gy = Math.min(gruesa.rows - 1, Math.floor((by * block) / (block * COARSE_FACTOR)));
      const gi = gy * gruesa.cols + gx;
      values[i] = sauvola(gruesa.mean[gi] ?? m, gruesa.std[gi] ?? sd);
    }
  }
  return { values, cols: fina.cols, rows: fina.rows, block };
}

/**
 * Umbral en (x, y), interpolado **bilinealmente** entre los centros de bloque. Sin
 * interpolar, el borde entre bloques produce escalones en la binarización que el
 * detector confunde con extremos de pared.
 */
function thresholdAt(field: ThresholdField, x: number, y: number): number {
  const { values, cols, rows, block } = field;
  // Coordenada en la rejilla, tomando el centro de cada bloque como muestra.
  const gx = Math.min(cols - 1, Math.max(0, (x - block / 2) / block));
  const gy = Math.min(rows - 1, Math.max(0, (y - block / 2) / block));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const v00 = values[y0 * cols + x0] ?? 0;
  const v10 = values[y0 * cols + x1] ?? v00;
  const v01 = values[y1 * cols + x0] ?? v00;
  const v11 = values[y1 * cols + x1] ?? v00;
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
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
  sample: (along: number) => number,
  thresholdFor: (along: number) => number,
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
    const dark = sample(a) < thresholdFor(a);
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
  /** Banda en construcción: un grupo de tramos que son la MISMA pared física. */
  interface Band {
    minLine: number;
    maxLine: number;
    start: number;
    end: number;
    bestDarkFrac: number;
  }
  const bands: Band[] = [];
  // Ordenado por línea ascendente, la pertenencia se decide contra el borde
  // (`maxLine`) de la banda, así que las bandas crecen de forma transitiva.
  const sorted = [...runs].sort((a, b) => a.line - b.line || a.start - b.start);

  for (const run of sorted) {
    let absorbed = false;
    for (const band of bands) {
      // ⚠️ La distancia se mide contra el BORDE de la banda, no contra un
      // representante fijo. Con el representante, un muro relleno de 20 px se
      // partía en ~5 paredes (el representante se quedaba en la línea 0 y la
      // línea 4 ya no «alcanzaba»), y en el modelo RF cada una cobraba su
      // atenuación: 5 × 8 dB = 40 dB de tabique. Eso era AUD3-35.
      const near = run.line - band.maxLine <= MERGE_PERP_DIST;
      const overlap = run.start <= band.end && band.start <= run.end;
      if (near && overlap) {
        band.minLine = Math.min(band.minLine, run.line);
        band.maxLine = Math.max(band.maxLine, run.line);
        band.start = Math.min(band.start, run.start);
        band.end = Math.max(band.end, run.end);
        band.bestDarkFrac = Math.max(band.bestDarkFrac, run.darkFrac);
        absorbed = true;
        break;
      }
    }
    if (!absorbed) {
      bands.push({
        minLine: run.line,
        maxLine: run.line,
        start: run.start,
        end: run.end,
        bestDarkFrac: run.darkFrac,
      });
    }
  }

  // Cada banda es UNA pared, colocada en su eje central: es donde está de verdad
  // el muro, no en el primer píxel donde se le vio.
  return (
    bands
      // Una pared es ALARGADA. Un muro macizo lo bastante grueso también genera
      // tramos en el eje perpendicular —la sección transversal del propio muro—,
      // y esos aparecerían como paredes cruzadas que no existen, cobrando
      // atenuación en el modelo RF. Se descartan por relación de aspecto: lo que
      // es casi tan ancho como largo no es una pared, es una mancha.
      .filter((b) => {
        const largo = b.end - b.start + 1;
        const grosor = b.maxLine - b.minLine + 1;
        return largo >= grosor * MIN_ASPECT_RATIO;
      })
      .map((b) => ({
        line: (b.minLine + b.maxLine) / 2,
        start: b.start,
        end: b.end,
        darkFrac: b.bestDarkFrac,
      }))
  );
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
  /** Umbral fijo si el llamante lo impuso; si no, `null` y manda el campo local. */
  fixedThreshold: number | null;
  field: ThresholdField | null;
  minRun: number;
  minConfidence: number;
  maxSide: number;
}

function resolveParams(img: GrayImage, opts: WallDetectOptions): Resolved {
  const maxSide = Math.max(img.width, img.height);
  const minLength = opts.minLength ?? DEFAULT_MIN_LENGTH;
  const fixed = typeof opts.threshold === 'number' ? opts.threshold : null;
  return {
    fixedThreshold: fixed,
    // El campo local solo se calcula si de verdad se va a usar.
    field: fixed === null ? buildThresholdField(img) : null,
    minRun: Math.max(2, Math.ceil(minLength * maxSide)),
    minConfidence: opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
    maxSide,
  };
}

/** Umbral a aplicar en el píxel (x, y): el fijo del llamante o el local. */
function thresholdOf(p: Resolved, x: number, y: number): number {
  if (p.fixedThreshold !== null) return p.fixedThreshold;
  return p.field ? thresholdAt(p.field, x, y) : 0;
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
    const found = scanLine(
      y,
      width,
      p.minRun,
      (x) => data[base + x] ?? 255,
      (x) => thresholdOf(p, x, y),
    );
    for (const r of found) hRuns.push(r);
  }

  // Verticales: recorre cada columna.
  const vRuns: Run[] = [];
  for (let x = 0; x < width; x++) {
    const found = scanLine(
      x,
      height,
      p.minRun,
      (y) => data[y * width + x] ?? 255,
      (y) => thresholdOf(p, x, y),
    );
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
    const found = scanLine(
      y,
      width,
      p.minRun,
      (x) => data[base + x] ?? 255,
      (x) => thresholdOf(p, x, y),
    );
    for (const r of found) hRuns.push(r);
    if (y % YIELD_EVERY === YIELD_EVERY - 1) await yield0();
  }

  const vRuns: Run[] = [];
  for (let x = 0; x < width; x++) {
    const found = scanLine(
      x,
      height,
      p.minRun,
      (y) => data[y * width + x] ?? 255,
      (y) => thresholdOf(p, x, y),
    );
    for (const r of found) vRuns.push(r);
    if (x % YIELD_EVERY === YIELD_EVERY - 1) await yield0();
  }

  return [
    ...toWalls(mergeRuns(hRuns), img, p, horizontalToWall),
    ...toWalls(mergeRuns(vRuns), img, p, verticalToWall),
  ];
}
