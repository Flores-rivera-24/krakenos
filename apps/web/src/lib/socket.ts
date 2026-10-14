import type { ClientToServerEvents, ServerToClientEvents } from '@krakenos/types';
import type { Socket } from 'socket.io-client';
import type { io as socketIo } from './socket-client';
import { useAuthStore } from '@/store/auth.store';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Lo que el resto de la app usa del socket. Es un subconjunto de `AppSocket` a
 * propósito: `getSocket()` es SÍNCRONO (lo llaman efectos y stores) pero la
 * librería llega por `import()`, así que lo que devuelve es una fachada que
 * encola las operaciones hasta que el socket real existe. Ampliar esta lista es
 * ampliar lo que hay que encolar.
 */
export interface LazySocket {
  on: AppSocket['on'];
  off: AppSocket['off'];
  emit: AppSocket['emit'];
  readonly connected: boolean;
  readonly active: boolean;
  io: Pick<AppSocket['io'], 'on' | 'off'>;
}

let facade: LazySocket | null = null;

function openSocket(io: typeof socketIo): AppSocket {
  const s: AppSocket = io({
    path: '/socket.io',
    autoConnect: false,
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
  return s;
}

/**
 * Conexión Socket.io singleton y tipada hacia el agente. El servidor exige un
 * access token válido en el handshake, así que se envía en `auth.token`. Como
 * `auth` es una función, socket.io la invoca en cada (re)conexión y siempre
 * coge el token vigente del store; ante un fallo de auth (token caducado) se
 * intenta un refresco y se reconecta una vez.
 *
 * La librería se carga en la PRIMERA llamada (no al arrancar la app). Hasta que
 * llega, las suscripciones (`on`/`off`/`emit`) se encolan y se aplican EN ORDEN
 * sobre el socket real **antes** de conectar, de modo que ningún evento —ni el
 * `connect` ni el snapshot inicial— se pierde. Mientras tanto `connected` es
 * `false` y `active` es `true` (la misma lectura que daba el socket real recién
 * creado: «conectando»).
 */
export function getSocket(): LazySocket {
  if (facade) return facade;

  let real: AppSocket | null = null;
  const pending: Array<(s: AppSocket) => void> = [];
  const run = (op: (s: AppSocket) => void): void => {
    if (real) op(real);
    else pending.push(op);
  };

  void import('./socket-client').then(({ io }) => {
    const s = openSocket(io);
    real = s;
    for (const op of pending.splice(0)) op(s);
    s.connect();
  });

  // Los métodos de socket.io están sobrecargados con genéricos de eventos que una
  // fachada genérica no puede reexpresar: el contrato tipado lo da `LazySocket`.
  const lazy = {
    on: (...args: unknown[]) => {
      run((s) => (s.on as (...a: unknown[]) => unknown)(...args));
      return lazy;
    },
    off: (...args: unknown[]) => {
      run((s) => (s.off as (...a: unknown[]) => unknown)(...args));
      return lazy;
    },
    emit: (...args: unknown[]) => {
      run((s) => (s.emit as (...a: unknown[]) => unknown)(...args));
      return lazy;
    },
    get connected() {
      return real?.connected ?? false;
    },
    get active() {
      return real?.active ?? true;
    },
    io: {
      on: (...args: unknown[]) => {
        run((s) => (s.io.on as (...a: unknown[]) => unknown)(...args));
        return lazy.io;
      },
      off: (...args: unknown[]) => {
        run((s) => (s.io.off as (...a: unknown[]) => unknown)(...args));
        return lazy.io;
      },
    },
  };
  facade = lazy as unknown as LazySocket;
  return facade;
}
