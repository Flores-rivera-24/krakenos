/**
 * Modelo de predicción de cobertura WiFi por propagación RF.
 *
 * Todo el módulo son funciones PURAS y deterministas (sin estado, sin efectos):
 * dada la misma entrada devuelven exactamente la misma salida, de modo que el
 * mapa de calor predicho es reproducible y testeable al 100 %.
 *
 * Sistema de coordenadas (igual que `coverage.ts`): metros, origen
 * arriba-izquierda, `x` hacia la derecha, `y` hacia abajo.
 *
 * Modelo (log-distancia):
 *   FSPL_1m(band) = 20*log10(freqMHz) - 27.55
 *   PL(d)         = FSPL_1m + 10*n*log10(max(d, minDistanceM))
 *   RSSI_ap(p)    = ap.txPowerDbm - PL(d) - wallLoss(band)   con d = dist(ap, p)
 *   RSSI_celda    = max sobre APs (habilitados + banda), null si no hay o < floor.
 */
import type {
  ApPlacement,
  CoverageHeatmap,
  WallMaterial,
  Wall,
  WifiBand,
} from '@krakenos/types';
import { resolveGrid } from './grid.js';

/** Opciones del modelo de propagación (todas con valor por defecto salvo la banda). */
export interface PropagationOptions {
  band: WifiBand;
  /** Lado de cada celda cuadrada de la rejilla (m). Default 0.5. */
  cellSizeM?: number;
  /** Exponente de pérdida por distancia (n). Default 3.0. */
  pathLossExponent?: number;
  /** Suelo de sensibilidad (dBm): por debajo la celda es `null`. Default -95. */
  floorDbm?: number;
  /** Distancia mínima (m) para evitar la singularidad de log(0). Default 1. */
  minDistanceM?: number;
}

const DEFAULT_CELL_SIZE_M = 0.5;
const DEFAULT_PATH_LOSS_EXPONENT = 3.0;
const DEFAULT_FLOOR_DBM = -95;
const DEFAULT_MIN_DISTANCE_M = 1;

/** Frecuencia central de cada banda en MHz. */
const BAND_FREQ_MHZ: Record<WifiBand, number> = {
  '2.4GHz': 2450,
  '5GHz': 5500,
  '6GHz': 6000,
};

/** Atenuación base por material (dB), referida a 5 GHz. */
const WALL_BASE_ATTENUATION_DB: Record<WallMaterial, number> = {
  drywall: 3,
  wood: 4,
  glass: 6,
  brick: 8,
  concrete: 12,
  metal: 20,
};

/** Escala de la atenuación de pared relativa a 5 GHz (las bandas altas penetran peor). */
const BAND_WALL_SCALE: Record<WifiBand, number> = {
  '2.4GHz': 0.75,
  '5GHz': 1.0,
  '6GHz': 1.15,
};

/** FSPL (dB) a 1 metro para la banda dada: `20*log10(freqMHz) - 27.55`. */
export function fsplAt1m(band: WifiBand): number {
  return 20 * Math.log10(BAND_FREQ_MHZ[band]) - 27.55;
}

/**
 * Pérdida de trayecto (dB) a la distancia `d` (m) con el modelo log-distancia:
 * `FSPL_1m(band) + 10*n*log10(max(d, minDistanceM))`.
 */
export function pathLoss(
  d: number,
  band: WifiBand,
  n: number = DEFAULT_PATH_LOSS_EXPONENT,
  minDistanceM: number = DEFAULT_MIN_DISTANCE_M,
): number {
  const distance = Math.max(d, minDistanceM);
  return fsplAt1m(band) + 10 * n * Math.log10(distance);
}

/** Atenuación (dB) de una pared del material dado en la banda dada. */
export function wallAttenuationDb(material: WallMaterial, band: WifiBand): number {
  return WALL_BASE_ATTENUATION_DB[material] * BAND_WALL_SCALE[band];
}

/**
 * ¿Se cruzan los segmentos AB y CD? Método basado en orientaciones (producto
 * cruzado), robusto y sin división.
 *
 * Decisión sobre casos degenerados: el "tocar en un extremo" y el solape
 * colineal CUENTAN como intersección (comparaciones inclusivas). Es la elección
 * conservadora para el modelo RF: si el rayo AP→punto roza el borde de una
 * pared, se prefiere contar su atenuación a ignorarla.
 */
export function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const o1 = orientation(ax, ay, bx, by, cx, cy);
  const o2 = orientation(ax, ay, bx, by, dx, dy);
  const o3 = orientation(cx, cy, dx, dy, ax, ay);
  const o4 = orientation(cx, cy, dx, dy, bx, by);

  // Caso general: C y D a lados opuestos de AB, y A y B a lados opuestos de CD.
  if (o1 !== o2 && o3 !== o4) return true;

  // Casos colineales: un extremo cae dentro del otro segmento.
  if (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  if (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;

  return false;
}

/**
 * Orientación de la terna (p, q, r): `0` colineal, `1` horario, `2` antihorario.
 * Usa el signo del producto cruzado (pq × pr).
 */
function orientation(
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
): 0 | 1 | 2 {
  const val = (qx - px) * (ry - py) - (qy - py) * (rx - px);
  if (val === 0) return 0;
  return val > 0 ? 1 : 2;
}

/** ¿Está `r` dentro del rectángulo delimitador del segmento `pq` (asumiendo colinealidad)? */
function onSegment(
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
): boolean {
  return (
    rx >= Math.min(px, qx) &&
    rx <= Math.max(px, qx) &&
    ry >= Math.min(py, qy) &&
    ry <= Math.max(py, qy)
  );
}

/**
 * Atenuación total (dB) de todas las paredes cuyo segmento intersecta el rayo
 * (x1,y1)→(x2,y2), en la banda dada. Suma las atenuaciones individuales.
 */
export function wallLossAlong(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  walls: Wall[],
  band: WifiBand,
): number {
  let total = 0;
  for (const wall of walls) {
    if (segmentsIntersect(x1, y1, x2, y2, wall.x1, wall.y1, wall.x2, wall.y2)) {
      total += wallAttenuationDb(wall.material, band);
    }
  }
  return total;
}

/**
 * RSSI (dBm) que un AP produce en el punto (x, y), atravesando `walls`:
 * `ap.txPowerDbm - PL(d) - wallLoss`, con `d` la distancia euclídea AP→punto.
 */
export function rssiFromAp(
  x: number,
  y: number,
  ap: ApPlacement,
  walls: Wall[],
  opts: PropagationOptions,
): number {
  const dx = x - ap.x;
  const dy = y - ap.y;
  const d = Math.hypot(dx, dy);
  const n = opts.pathLossExponent ?? DEFAULT_PATH_LOSS_EXPONENT;
  const minDistanceM = opts.minDistanceM ?? DEFAULT_MIN_DISTANCE_M;
  const pl = pathLoss(d, opts.band, n, minDistanceM);
  const loss = wallLossAlong(ap.x, ap.y, x, y, walls, opts.band);
  return ap.txPowerDbm - pl - loss;
}

/**
 * Calcula el mapa de calor de cobertura PREDICHA sobre un plano de
 * `widthM`×`heightM` metros.
 *
 * - Filtra internamente los APs por `enabled` y por `bands.includes(band)`.
 * - Rejilla de celdas cuadradas de `cellSizeM`; el RSSI se evalúa en el CENTRO
 *   de cada celda.
 * - El valor de la celda es el MÁXIMO (más cercano a 0) sobre los APs válidos;
 *   `null` si no hay APs válidos o el mejor RSSI queda por debajo de `floorDbm`.
 * - `values` en orden row-major: `values[row * cols + col]`.
 */
export function computePredictedHeatmap(
  widthM: number,
  heightM: number,
  aps: ApPlacement[],
  walls: Wall[],
  opts: PropagationOptions,
): CoverageHeatmap {
  const floorDbm = opts.floorDbm ?? DEFAULT_FLOOR_DBM;
  const { band } = opts;

  // Rejilla compartida con la interpolación y acotada a MAX_HEATMAP_CELLS; el
  // `cellSizeM` puede agrandarse respecto al pedido para planos grandes.
  const { cols, rows, cellSizeM } = resolveGrid(
    widthM,
    heightM,
    opts.cellSizeM ?? DEFAULT_CELL_SIZE_M,
  );

  // Solo APs habilitados que emiten en la banda pedida.
  const activeAps = aps.filter((ap) => ap.enabled && ap.bands.includes(band));

  const values: (number | null)[] = new Array<number | null>(rows * cols);

  let minDbm = Number.POSITIVE_INFINITY;
  let maxDbm = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (col + 0.5) * cellSizeM;
      const y = (row + 0.5) * cellSizeM;

      let best: number | null = null;
      for (const ap of activeAps) {
        const rssi = rssiFromAp(x, y, ap, walls, opts);
        if (best === null || rssi > best) best = rssi;
      }

      const idx = row * cols + col;
      if (best === null || best < floorDbm) {
        values[idx] = null;
      } else {
        values[idx] = best;
        if (best < minDbm) minDbm = best;
        if (best > maxDbm) maxDbm = best;
      }
    }
  }

  // Sin ninguna celda con señal, las cotas colapsan al suelo de sensibilidad.
  if (!Number.isFinite(minDbm)) minDbm = floorDbm;
  if (!Number.isFinite(maxDbm)) maxDbm = floorDbm;

  return {
    band,
    source: 'predicted',
    widthM,
    heightM,
    cols,
    rows,
    cellSizeM,
    values,
    minDbm,
    maxDbm,
  };
}
