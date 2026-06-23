import type { ClientToServerEvents, ServerToClientEvents } from '@krakenos/types';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/auth.store';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/**
 * Conexión Socket.io singleton y tipada hacia el agente. El servidor exige un
 * access token válido en el handshake, así que se envía en `auth.token`. Como
 * `auth` es una función, socket.io la invoca en cada (re)conexión y siempre
 * coge el token vigente del store; ante un fallo de auth (token caducado) se
 * intenta un refresco y se reconecta una vez.
 */
export function getSocket(): AppSocket {
  if (!socket) {
    const s: AppSocket = io({
      path: '/socket.io',
      autoConnect: true,
      withCredentials: true,
      auth: (cb) => cb({ token: useAuthStore.getState().tokens?.accessToken ?? '' }),
    });

    let retriedAfterRefresh = false;
    s.on('connect', () => {
      retriedAfterRefresh = false;
    });
    s.on('connect_error', (err) => {
      // Solo reaccionamos a errores de autenticación del middleware del agente.
      if (/AUTH_/.test(err.message) && !retriedAfterRefresh) {
        retriedAfterRefresh = true;
        void useAuthStore
          .getState()
          .refresh()
          .then((ok) => {
            if (ok) s.connect();
          });
      }
    });

    // El agente re-verifica la sesión periódicamente (US-80): si el token expiró
    // o su clave se retiró, emite `auth:expired` y corta la conexión. Un disconnect
    // iniciado por el servidor no auto-reconecta, así que refrescamos y reconectamos.
    s.on('auth:expired', () => {
      void useAuthStore
        .getState()
        .refresh()
        .then((ok) => {
          if (ok) s.connect();
        });
    });

    socket = s;
  }
  return socket;
}
