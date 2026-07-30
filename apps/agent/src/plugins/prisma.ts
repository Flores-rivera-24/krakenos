import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * PRAGMAs de SQLite que se aplican al conectar (US-228, AUD3-09).
 *
 * Hasta ahora el cliente se creaba pelado y la base corría en **rollback journal**
 * (verificado: `journal_mode` = `delete`, solo aparecían ficheros `-journal`). Con
 * ese modo, **cada** escritura toma un lock EXCLUSIVE que bloquea a todos los
 * lectores, y el agente escribe ~50-90 transacciones por minuto en reposo (rollups
 * de tráfico y energía, barrido de inventario, auditoría): en una microSD eso es
 * varios puntos porcentuales de duty cycle con la base entera parada, y es la causa
 * raíz de que la app «se atragante» mientras corre un barrido.
 *
 * - `journal_mode=WAL`: lectores y escritor conviven. Es persistente en el fichero,
 *   pero se re-aplica en cada arranque por si la base viene de una copia antigua.
 * - `synchronous=NORMAL`: en WAL es el valor recomendado — se elimina un fsync por
 *   commit conservando la integridad ante caída de proceso (solo un corte de luz
 *   justo en el checkpoint podría perder la última transacción, que aquí es una
 *   muestra de tráfico, no una operación del usuario).
 * - `busy_timeout=5000`: si aun así hay contención, se espera en vez de devolver
 *   `SQLITE_BUSY` al usuario.
 * - `foreign_keys=ON`: Prisma ya lo activa por conexión; se deja explícito para que
 *   una consulta cruda no dependa de ese detalle.
 */
export const SQLITE_PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA busy_timeout = 5000',
  'PRAGMA foreign_keys = ON',
];

/** Cliente mínimo que necesita `applySqlitePragmas` (facilita testearlo aislado). */
export interface PragmaRunner {
  $queryRawUnsafe(query: string): Promise<unknown>;
}

/**
 * Aplica los PRAGMAs a una conexión ya abierta. Exportado **para poder probarlo
 * contra una base nueva**: el test de contrato anterior (`sqlite-pragmas.test.ts`)
 * consultaba `journal_mode` sobre `prisma/test.db`, que **ya venía en WAL** de
 * ejecuciones anteriores (el modo es persistente en el fichero), así que no podía
 * distinguir «el plugin lo aplicó» de «el fichero ya estaba así» — el mismo falso
 * verde que US-230 fue a cazar.
 *
 * Devuelve los PRAGMAs que fallaron, para que el llamante decida qué registrar.
 */
export async function applySqlitePragmas(
  client: PragmaRunner,
  onError?: (pragma: string, err: unknown) => void,
): Promise<string[]> {
  const fallidos: string[] = [];
  for (const pragma of SQLITE_PRAGMAS) {
    try {
      // ⚠️ `$queryRawUnsafe`, NO `$executeRawUnsafe`. `PRAGMA journal_mode = WAL`
      // **devuelve una fila** (`{journal_mode: 'wal'}`) y `executeRaw` la rechaza
      // con «Execute returned results, which is not allowed in SQLite».
      //
      // El efecto ocurría igualmente —SQLite ejecuta el pragma y Prisma se queja
      // después—, así que WAL acababa activo; pero el arranque registraba «No se
      // pudo aplicar el PRAGMA» en CADA inicio: un aviso **falso** que hacía
      // indistinguible el fallo real. Y dependía de un detalle de implementación:
      // si Prisma envolviera la sentencia en algo que revierte, WAL dejaría de
      // aplicarse y el log diría exactamente lo mismo que ahora.
      await client.$queryRawUnsafe(pragma);
    } catch (err) {
      fallidos.push(pragma);
      onError?.(pragma, err);
    }
  }
  return fallidos;
}

/** Expone un único `PrismaClient` y lo cierra al apagar el servidor. */
export const prismaPlugin = fp(async (app: FastifyInstance) => {
  const prisma = new PrismaClient();
  await prisma.$connect();

  // Best-effort: si un PRAGMA falla de verdad (FS raro, permisos), se registra y
  // se sigue — es una optimización de I/O, no un requisito de arranque.
  await applySqlitePragmas(prisma, (pragma, err) => {
    app.log.warn({ err, pragma }, 'No se pudo aplicar el PRAGMA de SQLite');
  });

  app.decorate('prisma', prisma);

  app.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect();
  });
});
