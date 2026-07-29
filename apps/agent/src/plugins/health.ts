import type { FastifyPluginAsync } from 'fastify';
import { createReadinessProbe } from '../system/readiness.js';

/**
 * Healthcheck público y mínimo (US-58): responde solo `{ status: 'ok' }`. No
 * expone el driver activo ni el uptime del proceso, que filtraban información de
 * la instancia a cualquiera sin autenticación.
 *
 * `/health/ready` (US-115) es una sonda de **readiness** para orquestadores
 * (Docker/K8s). Desde US-233 **comprueba que se puede escribir**, no solo que la
 * base responde: con la SD en solo-lectura o el disco lleno, un `SELECT 1` sigue
 * devolviendo 200 mientras nada se persiste (AUD3-21). El resultado se cachea unos
 * segundos porque esta sonda se llama en bucle. 200 `{status:'ready'}` o 503
 * `{status:'not-ready'}` — sin filtrar detalles del error.
 */
export interface HealthRoutesOptions {
  /**
   * Cuánto vale el resultado de la sonda antes de volver a escribir el canario.
   * Los tests lo bajan a 0 para poder observar la escritura; en producción vale el
   * default (la sonda se llama en bucle).
   */
  readinessThrottleMs?: number;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, opts) => {
  app.get('/health', async () => ({ status: 'ok' }));

  const readiness = createReadinessProbe({
    prisma: app.prisma,
    throttleMs: opts.readinessThrottleMs,
    onFail: (err) =>
      app.log.error(
        { err },
        '[health] la comprobación de escritura falló: ¿disco lleno o sistema de ficheros en solo-lectura?',
      ),
  });

  app.get('/health/ready', async (_req, reply) => {
    if (await readiness.check()) return { status: 'ready' };
    return reply.code(503).send({ status: 'not-ready' });
  });
};
