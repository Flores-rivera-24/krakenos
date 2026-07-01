/**
 * Geometría de la rejilla del heatmap de cobertura, COMPARTIDA por la predicción
 * (`propagation.ts`) y la interpolación de survey (`interpolation.ts`) para que
 * ambos mapas se superpongan celda a celda por construcción.
 *
 * Además acota el número total de celdas: con planos grandes (el schema admite
 * hasta cientos de metros) una celda fija de 0,5 m generaría millones de celdas,
 * y el cálculo es O(celdas · APs · paredes) SÍNCRONO en el event loop, además de
 * un JSON de respuesta enorme. `resolveGrid` agranda el lado de celda lo justo
 * para no superar `MAX_HEATMAP_CELLS`, devolviendo el `cellSizeM` REAL usado (que
 * viaja en el DTO, así el frontend escala el raster con la misma geometría).
 */

/** Tope duro de celdas de una rejilla de heatmap. */
export const MAX_HEATMAP_CELLS = 250_000;

export interface GridDims {
  cols: number;
  rows: number;
  /** Lado de celda REAL usado (m); puede ser mayor que el pedido si se acotó. */
  cellSizeM: number;
}

/**
 * Resuelve `cols`/`rows`/`cellSizeM` para un plano de `widthM`×`heightM` metros
 * a partir del `cellSizeM` pedido:
 * - `cols = max(1, ceil(widthM / cellSizeM))`, `rows` análogo.
 * - Si `cols*rows` supera `MAX_HEATMAP_CELLS`, agranda el lado de celda a
 *   `sqrt(area / MAX_HEATMAP_CELLS)` y recalcula.
 * Blinda también los casos degenerados: `cellSizeM<=0` (evita dividir por cero /
 * bucle infinito) y dimensiones negativas.
 */
export function resolveGrid(widthM: number, heightM: number, cellSizeM: number): GridDims {
  const w = Math.max(0, widthM);
  const h = Math.max(0, heightM);
  let cell = cellSizeM > 0 ? cellSizeM : 0.5;

  let cols = Math.max(1, Math.ceil(w / cell));
  let rows = Math.max(1, Math.ceil(h / cell));

  if (cols * rows > MAX_HEATMAP_CELLS) {
    cell = Math.max(cell, Math.sqrt((w * h) / MAX_HEATMAP_CELLS));
    cols = Math.max(1, Math.ceil(w / cell));
    rows = Math.max(1, Math.ceil(h / cell));
    // El redondeo hacia arriba (ceil) puede dejar el producto ligeramente por
    // encima del tope; agranda la celda hasta cumplirlo estrictamente. Converge
    // en pocas iteraciones (cols·rows → 1 cuando cell → ∞).
    while (cols * rows > MAX_HEATMAP_CELLS) {
      cell *= 1.05;
      cols = Math.max(1, Math.ceil(w / cell));
      rows = Math.max(1, Math.ceil(h / cell));
    }
  }

  return { cols, rows, cellSizeM: cell };
}
