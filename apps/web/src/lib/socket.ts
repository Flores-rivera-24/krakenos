import type { ClientToServerEvents, ServerToClientEvents } from '@krakenos/types';
import { io, type Socket } from 'socket.io-client';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/** Conexión Socket.io singleton y tipada hacia el agente. */
export function getSocket(): AppSocket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      autoConnect: true,
      withCredentials: true,
    });
  }
  return socket;
}
