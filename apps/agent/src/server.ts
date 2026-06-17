import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { createDriver } from './drivers/index.js';
import { authPlugin } from './plugins/auth.js';
import { prismaPlugin } from './plugins/prisma.js';
import { socketioPlugin } from './plugins/socketio.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { wifiRoutes } from './modules/wifi/wifi.routes.js';

/** Construye la instancia de Fastify con todos los plugins y rutas. */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.isProd ? 'info' : 'debug',
      transport: env.isProd ? undefined : { target: 'pino-pretty' },
    },
  });

  // Infra
  await app.register(cors, { origin: env.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(socketioPlugin);

  // Driver de hardware compartido por los módulos que lo necesitan.
  const driver = createDriver({ kind: env.driver.kind, host: env.driver.host });

  // Healthcheck público.
  app.get('/health', async () => ({
    status: 'ok',
    driver: driver.kind,
    uptime: process.uptime(),
  }));

  // Módulos del MVP.
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(inventoryRoutes, { prefix: '/api/inventory', driver });
  await app.register(wifiRoutes, { prefix: '/api/wifi', driver });

  return app;
}
