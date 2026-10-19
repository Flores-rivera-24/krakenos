import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';
import { resolveDbFile } from './database-url.js';
import { serialized } from './serialized-adapter.js';

export interface CreatePrismaClientOptions {
  /**
   * `file:…` o ruta de la base. Por defecto `DATABASE_URL`, o `file:./dev.db` (la misma
   * regla del resto del agente; una ruta relativa cuelga de `prisma/`, ver `resolveDbFile`).
   */
  databaseUrl?: string;
}

/**
 * ÚNICA fábrica de `PrismaClient` del agente (US-276).
 *
 * Con Prisma 7 no hay motor nativo: el cliente habla con SQLite a través del adaptador
 * de `better-sqlite3`, que se construye aquí con la URL ya resuelta y el formato de
 * fecha que fija el invariante de `db/sql-aggregate.ts`.
 *
 * ## `timestampFormat: 'unixepoch-ms'` (NO quitar)
 *
 * El adaptador escribe por defecto las fechas como texto ISO 8601. Prisma 5 las
 * guardaba como INTEGER de milisegundos, y `db/sql-aggregate.ts` agrega con aritmética
 * entera sobre esa columna (`(timestamp / :bucketMs) * :bucketMs`) y compara
 * `timestamp >= :sinceMs`. Con el formato por defecto, las filas nuevas serían texto,
 * las viejas enteros, y los informes de tráfico, energía y bienestar agruparían mal
 * **sin ningún error**. Lo atan `test/unit/prisma7-fixture.test.ts` (una fila escrita
 * por Prisma 7 es `integer` en ms) y el cruce con la fixture de Prisma 5.
 *
 * Fuente: la sección «better-sqlite3» de la documentación de SQLite de Prisma
 * (`new PrismaBetterSqlite3({ url }, { timestampFormat: "unixepoch-ms" })`, «Required
 * for migrating from Prisma's native driver») y `dist/index.mjs` del adaptador 7.10.0
 * (`mapArg`: `arg.getTime()` con ese formato; la lectura de una columna DATETIME acepta
 * tanto enteros como texto).
 */
export function createPrismaClient(opts: CreatePrismaClientOptions = {}): PrismaClient {
  const dbFile = resolveDbFile(opts.databaseUrl ?? process.env.DATABASE_URL ?? 'file:./dev.db');
  const adapter = new PrismaBetterSqlite3(
    { url: `file:${dbFile}` },
    { timestampFormat: 'unixepoch-ms' },
  );
  // `serialized`: una sola conexión, sin entrelazar consultas sueltas con una transacción.
  return new PrismaClient({ adapter: serialized(adapter) });
}
