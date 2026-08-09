/**
 * Tipos del checker de presupuesto de bundle.
 *
 * El script es `.mjs` porque lo ejecuta Node directamente en CI (sin pasar por
 * el bundler), así que no puede llevar tipos dentro. Esta declaración existe
 * para que su test —que ahora SÍ se typechequea— no lo importe como `any`: un
 * `any` aquí dejaría el gate del presupuesto sin comprobar sus propias firmas,
 * que es justo lo que se acaba de arreglar en el resto de la suite.
 */
export interface BundleChunk {
  /** Nombre del fichero emitido, p. ej. `index-BFOKBPkT.js`. */
  name: string;
  /** Tamaño comprimido en kB. */
  gzipKb: number;
}

export interface BundleBudget {
  /** Tope de la SUMA de los chunks de entrada (`index-*`). */
  maxEntryKb: number;
  /** Tope de CADA chunk por separado, entrada incluida. */
  maxChunkKb: number;
  /** Tope de la suma de todo lo emitido. */
  maxTotalKb: number;
}

/** Devuelve una violación por cada tope superado; vacío si todo cabe. */
export function checkBudget(chunks: BundleChunk[], budget: BundleBudget): string[];
