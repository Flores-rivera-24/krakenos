import type { FastifyPluginAsync } from 'fastify';

/**
 * Healthcheck público y mínimo (US-58): responde solo `{ status: 'ok' }`. No
 * expone el driver activo ni el uptime del proceso, que filtraban información de
 * la instancia a cualquiera sin autenticación.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ status: 'ok' }));
};
