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
import { ROWS_PER_YIELD, yieldToEventLoop } from './chunk.js';
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
interface MeasuredOpts {
  band: WifiBand;
  cellSizeM?: number;
  power?: number;
  maxRadiusM?: number;
}

interface MeasuredSetup {
  cols: number;
  rows: number;
  cellSizeM: number;
  power: number;
  maxRadiusM: number;
  values: (number | null)[];
}

/** Prepara la rejilla (misma que la predicción) y reserva el buffer de valores. */
function setupMeasured(widthM: number, heightM: number, opts: MeasuredOpts): MeasuredSetup {
  const { cols, rows, cellSizeM } = resolveGrid(
    widthM,
    heightM,
    opts.cellSizeM ?? DEFAULT_CELL_SIZE_M,
  );
  return {
    cols,
    rows,
    cellSizeM,
    power: opts.power ?? DEFAULT_POWER,
    maxRadiusM: opts.maxRadiusM ?? DEFAULT_MAX_RADIUS_M,
    values: new Array<number | null>(rows * cols),
  };
}

/** Rellena UNA fila del heatmap medido por IDW (matemática compartida sync/async). */
function fillMeasuredRow(row: number, setup: MeasuredSetup, samples: SurveySample[]): void {
  const { cols, cellSizeM, power, maxRadiusM, values } = setup;
  for (let c = 0; c < cols; c++) {
    const cx = (c + 0.5) * cellSizeM;
    const cy = (row + 0.5) * cellSizeM;
    values[row * cols + c] = idwEstimate(cx, cy, samples, power, maxRadiusM);
  }
}

/** Cotas de la leyenda: rango real de las muestras, o un rango por defecto si no hay. */
function measuredBounds(samples: SurveySample[]): { minDbm: number; maxDbm: number } {
  if (samples.length === 0) return { minDbm: -90, maxDbm: -30 };
  let minDbm = Infinity;
  let maxDbm = -Infinity;
  for (const sample of samples) {
    if (sample.rssiDbm < minDbm) minDbm = sample.rssiDbm;
    if (sample.rssiDbm > maxDbm) maxDbm = sample.rssiDbm;
  }
  return { minDbm, maxDbm };
}

function finalizeMeasured(
  widthM: number,
  heightM: number,
  band: WifiBand,
  setup: MeasuredSetup,
  samples: SurveySample[],
): CoverageHeatmap {
  const { minDbm, maxDbm } = measuredBounds(samples);
  return {
    band,
    source: 'measured',
    widthM,
    heightM,
    cols: setup.cols,
    rows: setup.rows,
    cellSizeM: setup.cellSizeM,
    values: setup.values,
    minDbm,
    maxDbm,
  };
}

export function computeMeasuredHeatmap(
  widthM: number,
  heightM: number,
  samples: SurveySample[],
  opts: MeasuredOpts,
): CoverageHeatmap {
  const setup = setupMeasured(widthM, heightM, opts);
  for (let r = 0; r < setup.rows; r++) {
    fillMeasuredRow(r, setup, samples);
  }
  return finalizeMeasured(widthM, heightM, opts.band, setup, samples);
}

/**
 * Igual que `computeMeasuredHeatmap` pero **cede el event loop** cada
 * `ROWS_PER_YIELD` filas para no congelar el proceso con un plano grande.
 * Resultado idéntico al síncrono (misma matemática compartida).
 */
export async function computeMeasuredHeatmapAsync(
  widthM: number,
  heightM: number,
  samples: SurveySample[],
  opts: MeasuredOpts,
): Promise<CoverageHeatmap> {
  const setup = setupMeasured(widthM, heightM, opts);
  for (let r = 0; r < setup.rows; r++) {
    fillMeasuredRow(r, setup, samples);
    if (r % ROWS_PER_YIELD === ROWS_PER_YIELD - 1) await yieldToEventLoop();
  }
  return finalizeMeasured(widthM, heightM, opts.band, setup, samples);
}
