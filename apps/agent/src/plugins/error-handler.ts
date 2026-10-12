import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Manejador de errores global.
 *
 * El de Fastify por defecto manda `error.message` también en los 5xx, así que un fallo
 * de Prisma o de un driver llegaba al cliente con rutas, SQL y detalles internos. Aquí:
 *
 * - **4xx**: idéntico al de Fastify (respeta `statusCode`, `code` y `message`, también
 *   los errores de validación). El contrato 4xx no cambia.
 * - **5xx**: el error completo va al log; el cliente recibe un mensaje genérico salvo en los
 *   5xx deliberados con `code` propio (p. ej. `DRIVER_UNAVAILABLE`), cuyo copy es nuestro.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const status = error.statusCode ?? 500;
    if (status < 500) {
      // Mismo cuerpo que el handler por defecto de Fastify.
      return reply.status(status).send({
        statusCode: status,
        code: error.code,
        error: statusErrorName(status),
        message: error.message,
      });
    }
    req.log.error({ err: error }, 'error interno no controlado');
    // Un 5xx DELIBERADO (`statusCode` explícito, p. ej. 502 DRIVER_UNAVAILABLE) conserva
    // su estado y su `code`, que el front distingue. Su mensaje se conserva solo si además
    // lleva un `code` PROPIO: es copy escrito por nosotros (la web en español lo pinta tal
    // cual, `describeError`) y no lleva la causa. Los 5xx internos de Fastify (`FST_*`) y
    // los errores sin `statusCode` (Prisma, un bug) salen con mensaje genérico: su `code`
    // (P2002…) y su texto son detalles internos.
    const deliberado = error.statusCode !== undefined && error.statusCode >= 500;
    const codigoPropio = deliberado && !!error.code && !error.code.startsWith('FST_');
    return reply.status(deliberado ? status : 500).send({
      statusCode: deliberado ? status : 500,
      code: codigoPropio ? error.code : 'INTERNAL_ERROR',
      error: STATUS_CODES[deliberado ? status : 500] ?? 'Internal Server Error',
      message: codigoPropio ? error.message : 'Error interno del servidor.',
    });
  });
}

/** Nombre HTTP estándar del estado (`Bad Request`, `Not Found`…), como el de Fastify. */
function statusErrorName(status: number): string {
  // `http.STATUS_CODES` es lo que usa Fastify por dentro.
  return STATUS_CODES[status] ?? 'Error';
}
