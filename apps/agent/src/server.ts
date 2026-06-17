import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { createDriver } from './drivers/index.js';
import { auditPlugin } from './plugins/audit.js';
import { authPlugin } from './plugins/auth.js';
import { prismaPlugin } from './plugins/prisma.js';
import { socketioPlugin } from './plugins/socketio.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { setupRoutes } from './modules/setup/setup.routes.js';
import { systemRoutes } from './modules/system/system.routes.js';
import { wifiRoutes } from './modules/wifi/wifi.routes.js';

/** Construye la instancia de Fastify con todos los plugins y rutas. */
export async function buildServer(): Promise<FastifyInstance> {
  const logger = {
    level: env.isProd ? 'info' : 'debug',
    transport: env.isProd ? undefined : { target: 'pino-pretty' },
  };

  // TLS opcional: si hay cert/clave, el agente sirve HTTPS.
  const app: FastifyInstance = env.https
    ? (Fastify({ logger, https: env.https }) as unknown as FastifyInstance)
    : Fastify({ logger });

  // Infra
  await app.register(cors, { origin: env.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(prismaPlugin);
  await app.register(auditPlugin);
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
  await app.register(setupRoutes, { prefix: '/api/setup' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(inventoryRoutes, { prefix: '/api/inventory', driver });
  await app.register(wifiRoutes, { prefix: '/api/wifi', driver });
  await app.register(systemRoutes, { prefix: '/api/system' });
  await app.register(auditRoutes, { prefix: '/api/audit' });

  return app;
}
