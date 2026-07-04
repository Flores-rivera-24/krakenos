import type { FastifyPluginAsync } from 'fastify';

/**
 * Healthcheck público y mínimo (US-58): responde solo `{ status: 'ok' }`. No
 * expone el driver activo ni el uptime del proceso, que filtraban información de
 * la instancia a cualquiera sin autenticación.
 *
 * `/health/ready` (US-115) es una sonda de **readiness** para orquestadores
 * (Docker/K8s): comprueba que la base de datos responde. 200 `{status:'ready'}`
 * o 503 `{status:'not-ready'}` — sin filtrar detalles del error.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_req, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not-ready' });
    }
  });
};
