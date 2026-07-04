/**
 * Utilidades para trocear cálculos largos de cobertura sin **congelar el event
 * loop**. El cómputo del heatmap es O(celdas · APs · paredes) y con un plano
 * grande (hasta 250k celdas × 64 APs × 500 paredes) bloquearía el hilo principal
 * decenas de segundos — durante los cuales se caen los health checks, los
 * heartbeats de Socket.io y el resto de peticiones. Cediendo el event loop cada
 * pocas filas, el servidor sigue respondiendo mientras el mapa se calcula.
 */

/** Cede el event loop (macrotask) para atender I/O/timers pendientes. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Filas procesadas entre cada cesión del event loop. */
export const ROWS_PER_YIELD = 32;
