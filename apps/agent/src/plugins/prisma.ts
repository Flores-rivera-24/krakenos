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
const SQLITE_PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA busy_timeout = 5000',
  'PRAGMA foreign_keys = ON',
];

/** Expone un único `PrismaClient` y lo cierra al apagar el servidor. */
export const prismaPlugin = fp(async (app: FastifyInstance) => {
  const prisma = new PrismaClient();
  await prisma.$connect();

  // Best-effort: si un PRAGMA falla (base en un FS raro, permisos), se registra y se
  // sigue — es una optimización de I/O, no un requisito de arranque.
  for (const pragma of SQLITE_PRAGMAS) {
    try {
      await prisma.$executeRawUnsafe(pragma);
    } catch (err) {
      app.log.warn({ err, pragma }, 'No se pudo aplicar el PRAGMA de SQLite');
    }
  }

  app.decorate('prisma', prisma);

  app.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect();
  });
});
