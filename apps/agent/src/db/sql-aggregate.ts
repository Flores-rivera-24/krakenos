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
 * (verificado con `typeof(timestamp)` → `integer`; con Prisma 7 lo garantiza
 * `timestampFormat: 'unixepoch-ms'` en `db/client.ts`), así que el inicio del bucket es
 * aritmética entera pura y no hace falta `strftime`. Se construye con `bucketStart()`:
 *
 * ```sql
 * (timestamp / :bucketMs) * :bucketMs AS bucket
 * ```
 *
 * ## Reglas al escribir estas consultas
 *
 * - El **nombre de tabla y de columna van literales** en el template: nunca se
 *   interpolan desde datos del usuario. Solo `bucketMs` y `sinceMs` son parámetros
 *   (`$queryRaw` los enlaza, no los concatena). El ancho del bucket va SIEMPRE por
 *   `bucketStart()` (BigInt): como `number` se enlazaría como REAL (ver su doc).
 * - `AVG(x)` reproduce exactamente la media por bucket que hacía el JS, y
 *   `SUM(x)` los totales: la salida no cambia de forma.
 * - Los valores de un `$queryRaw` pueden llegar como `number` o `BigInt` según el
 *   tamaño del entero (un epoch en ms supera los 32 bits) → normalízalos con
 *   `asNumber`.
 */

import { Prisma } from '../generated/prisma/client.js';

/**
 * Inicio del bucket de `timestamp` como fragmento SQL: `(timestamp / :b) * :b`.
 *
 * ⚠️ El ancho va como **BigInt**, nunca como `number` (US-276). El adaptador de
 * better-sqlite3 enlaza un `number` de JS como REAL (`60000` → `60000.0`), y en SQLite
 * `INTEGER / REAL` es división **flotante**: `(timestamp / 60000.0) * 60000.0` devuelve
 * el propio `timestamp`, así que cada fila forma su propio bucket y los informes de
 * tráfico, energía y bienestar salen con 28 «buckets» de una muestra en vez de 6, sin
 * ningún error. Con Prisma 5 el motor enlazaba el entero como INTEGER. Un `BigInt` se
 * enlaza como INTEGER y la división vuelve a ser entera. Lo ata
 * `test/unit/prisma7-fixture.test.ts` contra el oráculo de Prisma 5.
 */
export function bucketStart(bucketMs: number): Prisma.Sql {
  const width = BigInt(Math.trunc(bucketMs));
  return Prisma.sql`(timestamp / ${width}) * ${width}`;
}

/** Normaliza un valor numérico de `$queryRaw` (puede venir como `BigInt`). */
export function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}
