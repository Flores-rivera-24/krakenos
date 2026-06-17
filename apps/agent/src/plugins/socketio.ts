import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Server } from 'socket.io';
import { env } from '../config/env.js';

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

declare module 'fastify' {
  interface FastifyInstance {
    io: IoServer;
  }
}

/**
 * Adjunta Socket.io al servidor HTTP de Fastify para emitir actualizaciones
 * de inventario en tiempo real.
 */
export const socketioPlugin = fp(async (app: FastifyInstance) => {
  const io: IoServer = new Server(app.server, {
    cors: { origin: env.webOrigin, credentials: true },
  });

  app.decorate('io', io);

  app.addHook('onClose', async (instance) => {
    await instance.io.close();
  });
});
