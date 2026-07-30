import type { ApPlacement, Wall, WifiBand } from '@krakenos/types';
import { rssiFromAp } from './propagation.js';

/**
 * Calibración del exponente de pérdida `n` con las medidas reales del recorrido
 * (US-237).
 *
 * ## El problema que resuelve
 *
 * El mapa predicho usaba `n = 3.0` **fijo para todas las casas**. Ese número es
 * una constante de libro: un piso diáfano está más cerca de 2, y uno de muros de
 * carga pasa de 4. Con `n` equivocado en 1 punto, a 10 m el error es de 10 dB —
 * suficiente para pintar zona muerta donde hay cobertura, o al revés.
 *
 * Y la casa **ya se midió**: el recorrido (`SurveySample`) tiene decenas de RSSI
 * reales con su posición. Ajustar `n` a esas medidas convierte una constante
 * inventada en un modelo de **esa** casa. Es la pieza que ya estaba a mano y nadie
 * usaba.
 *
 * ## Por qué búsqueda y no regresión lineal
 *
 * La linealización clásica (`y = PL0 + 10n·log d`) exige conocer **de qué AP**
 * viene cada medida, y una muestra del recorrido guarda solo `(x, y, rssiDbm)`:
 * es el **máximo sobre los APs**, igual que hace el mapa. Un barrido 1-D sobre `n`
 * evalúa exactamente el mismo modelo que luego se pinta —máximo incluido, con las
 * paredes y sus atenuaciones—, así que no hay error de linealización ni hay que
 * inventar la asociación muestra→AP.
 */

/** Medida real del recorrido: posición en metros y RSSI observado. */
export interface CalibrationSample {
  x: number;
  y: number;
  rssiDbm: number;
}

export interface CalibrationInput {
  samples: CalibrationSample[];
  aps: ApPlacement[];
  walls: Wall[];
  band: WifiBand;
  minDistanceM?: number;
}

export interface CalibrationResult {
  /** `n` ajustado a esta casa. */
  pathLossExponent: number;
  /** Muestras utilizadas. */
  sampleCount: number;
  /** Error cuadrático medio (dB) con el `n` ajustado. */
  rmseDb: number;
  /** RMSE con el `n` por defecto, para poder decir cuánto mejora. */
  baselineRmseDb: number;
}

/** Límites físicos razonables de `n` (espacio libre = 2; interiores densos ≈ 5). */
export const MIN_EXPONENT = 1.5;
export const MAX_EXPONENT = 6;
/** Paso del barrido. 0,05 está muy por debajo del ruido de una medida real. */
const STEP = 0.05;
/** `n` por defecto del modelo, usado como referencia de mejora. */
const DEFAULT_EXPONENT = 3.0;

/**
 * Mínimo de muestras para intentar ajustar. Con menos, `n` se ajustaría al ruido
 * de cuatro lecturas y daría un mapa **peor** que la constante — y encima con
 * apariencia de estar calibrado, que es lo peligroso.
 */
export const MIN_SAMPLES = 8;

/** RSSI predicho en un punto: el mejor AP, igual que hace el mapa de calor. */
function predictedAt(
  x: number,
  y: number,
  aps: ApPlacement[],
  walls: Wall[],
  band: WifiBand,
  n: number,
  minDistanceM: number | undefined,
): number | null {
  let best: number | null = null;
  for (const ap of aps) {
    const rssi = rssiFromAp(x, y, ap, walls, { band, pathLossExponent: n, minDistanceM });
    if (best === null || rssi > best) best = rssi;
  }
  return best;
}

/** RMSE (dB) del modelo con un `n` dado sobre las muestras. */
function rmseFor(input: CalibrationInput, n: number): number | null {
  let sum = 0;
  let count = 0;
  for (const s of input.samples) {
    const pred = predictedAt(s.x, s.y, input.aps, input.walls, input.band, n, input.minDistanceM);
    if (pred === null) continue;
    const err = pred - s.rssiDbm;
    sum += err * err;
    count++;
  }
  if (count === 0) return null;
  return Math.sqrt(sum / count);
}

/**
 * Ajusta `n` a las medidas del recorrido. Devuelve `null` —y el llamante se queda
 * con el valor por defecto— si no hay datos suficientes para un ajuste honesto:
 * sin APs, sin muestras, o con menos de `MIN_SAMPLES`.
 */
export function calibratePathLossExponent(input: CalibrationInput): CalibrationResult | null {
  const aps = input.aps.filter((ap) => ap.enabled !== false);
  if (aps.length === 0) return null;
  if (input.samples.length < MIN_SAMPLES) return null;

  const withAps: CalibrationInput = { ...input, aps };
  const baseline = rmseFor(withAps, DEFAULT_EXPONENT);
  if (baseline === null) return null;

  let bestN = DEFAULT_EXPONENT;
  let bestRmse = baseline;
  // Barrido determinista: mismo resultado para la misma entrada (el módulo entero
  // es puro y el mapa tiene que ser reproducible).
  for (let n = MIN_EXPONENT; n <= MAX_EXPONENT + 1e-9; n += STEP) {
    const rmse = rmseFor(withAps, n);
    if (rmse !== null && rmse < bestRmse) {
      bestRmse = rmse;
      bestN = n;
    }
  }

  return {
    // Redondeo a 2 decimales: más precisión sería fingir una resolución que las
    // medidas no tienen.
    pathLossExponent: Math.round(bestN * 100) / 100,
    sampleCount: input.samples.length,
    rmseDb: Math.round(bestRmse * 100) / 100,
    baselineRmseDb: Math.round(baseline * 100) / 100,
  };
}
