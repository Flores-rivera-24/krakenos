import { create } from 'zustand';
import { getSocket } from '@/lib/socket';

/**
 * Estado real de la conexión Socket.io (US-94):
 * - `connected`     → el stream está vivo.
 * - `reconnecting`  → caído pero el cliente está reintentando (socket activo).
 * - `offline`       → caído y sin reintento en curso (p. ej. corte del servidor
 *                     tras `auth:expired` antes de refrescar, o reintentos agotados).
 *
 * No se finge la reconexión: el valor se deriva de `socket.connected`/`socket.active`
 * de socket.io-client, que reflejan el estado real del transporte.
 */
export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

function readStatus(): ConnectionStatus {
  const s = getSocket();
  if (s.connected) return 'connected';
  // `socket.active` = el socket reintentará/está reintentando conectar.
  return s.active ? 'reconnecting' : 'offline';
}

interface ConnectionState {
  status: ConnectionStatus;
  /**
   * Cablea los eventos del socket y su manager a `status`. Idempotente por uso:
   * devuelve la función de limpieza. Se llama una vez desde el layout.
   */
  subscribe: () => () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  // Semilla optimista; `subscribe()` la corrige con el estado real al montar.
  status: 'connected',

  subscribe: () => {
    const s = getSocket();
    const update = () => set({ status: readStatus() });
    update();

    s.on('connect', update);
    s.on('disconnect', update);
    // Eventos del manager: cubren el ciclo de reintentos de reconexión.
    s.io.on('reconnect_attempt', update);
    s.io.on('reconnect_error', update);
    s.io.on('reconnect_failed', update);
    s.io.on('reconnect', update);

    return () => {
      s.off('connect', update);
      s.off('disconnect', update);
      s.io.off('reconnect_attempt', update);
      s.io.off('reconnect_error', update);
      s.io.off('reconnect_failed', update);
      s.io.off('reconnect', update);
    };
  },
}));
