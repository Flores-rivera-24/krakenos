/**
 * Interpolación espacial del heatmap de mediciones reales (survey).
 *
 * A partir de un conjunto de muestras de señal tomadas en puntos del plano se
 * estima el RSSI en el centro de cada celda de la rejilla mediante IDW (Inverse
 * Distance Weighting, ponderación por inverso de la distancia).
 *
 * La geometría de la rejilla es IDÉNTICA a la de la predicción por propagación
 * (`computePredictedHeatmap`) para que ambos mapas de calor se superpongan celda
 * a celda: mismo `cellSizeM` (0.5 m por defecto), mismo cálculo de `cols`/`rows`,
 * mismos centros de celda y el mismo orden row-major.
 *
 * Funciones PURAS: sin efectos secundarios ni dependencias de tiempo/estado.
 */
import type { CoverageHeatmap, SurveySample, WifiBand } from '@krakenos/types';
import { resolveGrid } from './grid.js';

/** `power` (exponente de la distancia) por defecto del IDW. */
const DEFAULT_POWER = 2;
/** Radio máximo de influencia (m) por defecto: fuera de él la celda es `null`. */
const DEFAULT_MAX_RADIUS_M = 4;
/** Tamaño de celda (m) por defecto de la rejilla; debe coincidir con la predicción. */
const DEFAULT_CELL_SIZE_M = 0.5;
/** Distancia (m) por debajo de la cual se considera que el punto coincide con la muestra. */
const COINCIDENCE_EPS_M = 1e-9;

/**
 * Estima el RSSI (dBm) en el punto `(x, y)` a partir de las `samples` mediante
 * IDW.
 *
 * - `dist = hypot(x - sx, y - sy)` a cada muestra.
 * - Si alguna `dist < 1e-9` (el punto coincide con una muestra) devuelve su
 *   `rssiDbm` directamente (evita dividir por cero).
 * - Si la distancia mínima supera `maxRadiusM` devuelve `null` (sin dato).
 * - En otro caso pondera con `w = 1 / dist^power` y devuelve
 *   `sum(w * rssi) / sum(w)`.
 *
 * @param power `power` del IDW (por defecto 2).
 * @param maxRadiusM radio máximo de influencia en metros (por defecto 4).
 */
export function idwEstimate(
  x: number,
  y: number,
  samples: { x: number; y: number; rssiDbm: number }[],
  power: number = DEFAULT_POWER,
  maxRadiusM: number = DEFAULT_MAX_RADIUS_M,
): number | null {
  let weightedSum = 0;
  let weightTotal = 0;
  let minDist = Infinity;

  for (const sample of samples) {
    const dist = Math.hypot(x - sample.x, y - sample.y);
    if (dist < COINCIDENCE_EPS_M) {
      // El punto coincide con una muestra: devuelve su valor exacto.
      return sample.rssiDbm;
    }
    if (dist < minDist) minDist = dist;
    const weight = 1 / dist ** power;
    weightedSum += weight * sample.rssiDbm;
    weightTotal += weight;
  }

  // Sin muestras (weightTotal 0) o la más cercana fuera del radio → sin dato.
  if (weightTotal === 0 || minDist > maxRadiusM) return null;

  return weightedSum / weightTotal;
}

/**
 * Calcula el heatmap de mediciones reales interpolando las `samples` sobre la
 * rejilla del plano.
 *
 * La rejilla usa la MISMA fórmula que la predicción:
 * - `cols = max(1, ceil(widthM / cellSizeM))`
 * - `rows = max(1, ceil(heightM / cellSizeM))`
 * - centro de la celda `(c, r)` = `((c + 0.5) * cellSizeM, (r + 0.5) * cellSizeM)`
 * - valores en orden row-major: `values[r * cols + c]`
 *
 * Si no hay muestras, todas las celdas quedan `null`.
 */
export function computeMeasuredHeatmap(
  widthM: number,
  heightM: number,
  samples: SurveySample[],
  opts: { band: WifiBand; cellSizeM?: number; power?: number; maxRadiusM?: number },
): CoverageHeatmap {
  const power = opts.power ?? DEFAULT_POWER;
  const maxRadiusM = opts.maxRadiusM ?? DEFAULT_MAX_RADIUS_M;

  // Misma rejilla acotada que la predicción (resolveGrid), para superponerse.
  const { cols, rows, cellSizeM } = resolveGrid(
    widthM,
    heightM,
    opts.cellSizeM ?? DEFAULT_CELL_SIZE_M,
  );

  const values: (number | null)[] = new Array<number | null>(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cellSizeM;
      const cy = (r + 0.5) * cellSizeM;
      values[r * cols + c] = idwEstimate(cx, cy, samples, power, maxRadiusM);
    }
  }

  // Cotas de la leyenda: rango real de las muestras medidas. Sin muestras usa
  // un rango por defecto razonable (banda WiFi típica).
  let minDbm = -90;
  let maxDbm = -30;
  if (samples.length > 0) {
    minDbm = Infinity;
    maxDbm = -Infinity;
    for (const sample of samples) {
      if (sample.rssiDbm < minDbm) minDbm = sample.rssiDbm;
      if (sample.rssiDbm > maxDbm) maxDbm = sample.rssiDbm;
    }
  }

  return {
    band: opts.band,
    source: 'measured',
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
