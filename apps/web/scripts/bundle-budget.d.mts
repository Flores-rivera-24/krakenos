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
  /** Tope de la carga inicial: entrada `index-*` + chunks `modulepreload` de `index.html`. */
  maxInitialKb: number;
  /** Tope de la PEOR ruta: carga inicial + lo que trae su página. */
  maxRouteKb: number;
  /** Tope de CADA chunk por separado, entrada incluida. */
  maxChunkKb: number;
}

export interface ManifestEntry {
  file: string;
  imports?: string[];
  dynamicImports?: string[];
}
export type Manifest = Record<string, ManifestEntry>;

export interface RouteWeight {
  route: string;
  /** Lo que la ruta añade a la carga inicial. */
  ownKb: number;
  /** Carga inicial + `ownKb`. */
  totalKb: number;
  chunks: string[];
}

/** Violaciones de la carga inicial y de cada chunk; vacío si todo cabe. Sin `initialNames` falla cerrado. */
export function checkBudget(
  chunks: BundleChunk[],
  budget: Pick<BundleBudget, 'maxInitialKb' | 'maxChunkKb'>,
  initialNames?: string[],
): string[];

/** Chunks JS que `index.html` carga al abrir: módulos de entrada y `modulepreload`. */
export function initialChunkNames(html: string): string[];

/** Páginas que `App.tsx` declara con `lazy(() => import('@/pages/X'))`. */
export function pageNames(appSource: string): string[];

/** Ficheros que trae una entrada del manifest por imports estáticos (transitivos). Lanza si falta una. */
export function staticClosure(manifest: Manifest, key: string): string[];

/** Peso por ruta. Lanza si una ruta, un extra o un chunk no está. */
export function routeWeights(input: {
  manifest: Manifest;
  chunks: BundleChunk[];
  initialNames: string[];
  pages: string[];
  publicPages?: string[];
  extras?: string[];
}): RouteWeight[];

/** Violaciones por ruta; exige medir al menos `expectedPages` y `minPages` (15) rutas. */
export function checkRoutes(
  weights: RouteWeight[],
  budget: Pick<BundleBudget, 'maxRouteKb'>,
  opts: { expectedPages: number; minPages?: number },
): string[];
