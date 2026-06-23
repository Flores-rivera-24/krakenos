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
  /** Token crudo del handshake, para re-verificarlo por TTL/rotación (US-80). */
  token: string;
}

/** Cada cuánto se re-verifica la sesión de los sockets conectados (US-80, F7). */
export const SESSION_RECHECK_MS = 30_000;

/**
 * ¿Sigue siendo válido este token de socket? Re-verifica firma + `type:'access'`
 * con el keyring actual (caduca por `exp`; deja de verificar si la clave fue
 * retirada en una rotación). Pura salvo por `verify` (inyectable para tests).
 */
export function isSocketTokenValid(
  token: string,
  verify: (t: string) => AccessTokenClaims,
): boolean {
  try {
    return verify(token).type === 'access';
  } catch {
    return false;
  }
}

/** Socket mínimo que necesita el barrido (compatible con el de socket.io). */
interface RecheckableSocket {
  data: { token: string };
  emit: (event: 'auth:expired') => unknown;
  disconnect: (close?: boolean) => unknown;
}

/**
 * Corta los sockets cuyo token ya no es válido: avisa con `auth:expired` (para que
 * el cliente refresque y reconecte) y los desconecta. Devuelve cuántos cortó.
 */
export function sweepStaleSockets(
  sockets: Iterable<RecheckableSocket>,
  verify: (t: string) => AccessTokenClaims,
): number {
  let cut = 0;
  for (const socket of sockets) {
    if (!isSocketTokenValid(socket.data.token, verify)) {
      socket.emit('auth:expired');
      socket.disconnect(true);
      cut++;
    }
  }
  return cut;
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
      // `verifyToken` elige la clave por `kid`: acepta también la clave previa
      // durante el solape de una rotación RS256 (US-64).
      const claims = app.verifyToken<AccessTokenClaims>(token);
      if (claims.type !== 'access') {
        return next(new Error('AUTH_INVALID_TOKEN'));
      }
      socket.data.user = claims;
      socket.data.token = token;
      next();
    } catch {
      next(new Error('AUTH_UNAUTHORIZED'));
    }
  });

  // Re-verificación periódica de la sesión (US-80, F7): el handshake solo valida
  // al conectar, así que sin esto una conexión seguiría recibiendo streams tras
  // expirar el token. Cada barrido re-verifica el token de cada socket y, si ya
  // no es válido (expirado o clave retirada), avisa al cliente (`auth:expired`,
  // para que refresque y reconecte) y corta la conexión. Acota la ventana de
  // sesión obsoleta al TTL del access token + el intervalo de barrido.
  const recheck = setInterval(() => {
    sweepStaleSockets(io.sockets.sockets.values(), (t) => app.verifyToken<AccessTokenClaims>(t));
  }, SESSION_RECHECK_MS);
  recheck.unref?.();

  app.decorate('io', io);

  app.addHook('onClose', async (instance) => {
    clearInterval(recheck);
    await instance.io.close();
  });
});
