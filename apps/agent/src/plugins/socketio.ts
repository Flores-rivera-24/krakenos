import type {
  AccessTokenClaims,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Server } from 'socket.io';
import { env } from '../config/env.js';

/** Datos que el middleware de auth adjunta a cada socket autenticado. */
export interface SocketData {
  user: AccessTokenClaims;
}

export type IoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

declare module 'fastify' {
  interface FastifyInstance {
    io: IoServer;
  }
}

/**
 * Extrae el access token del handshake: primero `auth.token` (lo natural en
 * socket.io-client), y como alternativa la cabecera `Authorization: Bearer`.
 */
function tokenFromHandshake(handshake: {
  auth?: { token?: unknown };
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const fromAuth = handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

  const header = handshake.headers.authorization;
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw?.startsWith('Bearer ')) return raw.slice('Bearer '.length);
  return null;
}

/**
 * Adjunta Socket.io al servidor HTTP de Fastify para emitir actualizaciones en
 * tiempo real. La conexión exige un **access token válido** en el handshake
 * (mismo JWT RS256 que la API): sin él se rechaza, de modo que los streams de
 * inventario/tráfico/IoT solo llegan a clientes autenticados ("lectura
 * autenticada", igual que las rutas HTTP).
 */
export const socketioPlugin = fp(async (app: FastifyInstance) => {
  const io: IoServer = new Server(app.server, {
    cors: { origin: env.webOrigin, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = tokenFromHandshake(socket.handshake);
      if (!token) {
        return next(new Error('AUTH_REQUIRED'));
      }
      const claims = app.jwt.verify<AccessTokenClaims>(token);
      if (claims.type !== 'access') {
        return next(new Error('AUTH_INVALID_TOKEN'));
      }
      socket.data.user = claims;
      next();
    } catch {
      next(new Error('AUTH_UNAUTHORIZED'));
    }
  });

  app.decorate('io', io);

  app.addHook('onClose', async (instance) => {
    await instance.io.close();
  });
});
