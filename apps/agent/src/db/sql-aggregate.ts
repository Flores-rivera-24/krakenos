/**
 * Agregación **en SQL** de las tablas de rollup (US-228, AUD3-13).
 *
 * Hasta ahora los informes traían todas las filas de la ventana a memoria y las
 * agrupaban en JS: `GET /api/energy/stats?range=month` cargaba ~864.000 filas,
 * `wellbeing/usage?range=week` ~403.000 (~100 MB de heap, y es una lectura abierta a
 * cualquier rol) y el snapshot de MQTT repetía la jugada **cada 30 s**. En una
 * Raspberry eso es un pico de GC y varios segundos de event loop bloqueado por una
 * petición que devuelve 30 puntos.
 *
 * La agregación se hace ahora en SQLite con `GROUP BY` sobre el bucket temporal, así
 * que el coste pasa de O(filas) a O(buckets × dispositivos).
 *
 * ## Cómo se calcula el bucket
 *
 * Prisma almacena `DateTime` en SQLite como **INTEGER de milisegundos** desde época
 * (verificado con `typeof(timestamp)` → `integer`), así que el inicio del bucket es
 * aritmética entera pura y no hace falta `strftime`:
 *
 * ```sql
 * (timestamp / :bucketMs) * :bucketMs AS bucket
 * ```
 *
 * ## Reglas al escribir estas consultas
 *
 * - El **nombre de tabla y de columna van literales** en el template: nunca se
 *   interpolan desde datos del usuario. Solo `bucketMs` y `sinceMs` son parámetros
 *   (`$queryRaw` los enlaza, no los concatena).
 * - `AVG(x)` reproduce exactamente la media por bucket que hacía el JS, y
 *   `SUM(x)` los totales: la salida no cambia de forma.
 * - Los valores de un `$queryRaw` pueden llegar como `number` o `BigInt` según el
 *   tamaño del entero (un epoch en ms supera los 32 bits) → normalízalos con
 *   `asNumber`.
 */

/** Normaliza un valor numérico de `$queryRaw` (puede venir como `BigInt`). */
export function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}
