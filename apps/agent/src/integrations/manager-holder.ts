/**
 * Holder recargable de un manager (US-141).
 *
 * Guarda la instancia viva del manager y expone un `handle` (Proxy) que delega
 * **siempre** en la instancia actual. Las rutas reciben el `handle` una sola vez al
 * arrancar; al reconfigurar una integración, `swap()` cambia la instancia subyacente
 * sin re-registrar plugins ni rutas de Fastify. `dispose` limpia la instancia saliente
 * (best-effort). Como las factories de managers ya son puras `(config) => manager`,
 * esto añade recarga en caliente sin tocar el código de los módulos.
 */
export interface ManagerHolder<T extends object> {
  /** Instancia viva actual. */
  readonly current: T;
  /** Handle transparente inyectable en las rutas; delega en `current` en cada llamada. */
  readonly handle: T;
  /** Sustituye la instancia viva por `next`; limpia la anterior con `dispose`. */
  swap(next: T): void;
}

export function createManagerHolder<T extends object>(
  initial: T,
  dispose?: (old: T) => void,
): ManagerHolder<T> {
  let current = initial;
  const handle = new Proxy({} as T, {
    get(_target, prop: string | symbol): unknown {
      const value = Reflect.get(current, prop) as unknown;
      // Los métodos se ligan a la instancia actual para que `this` sea correcto.
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(current)
        : value;
    },
    has(_target, prop: string | symbol): boolean {
      return Reflect.has(current, prop);
    },
  });
  return {
    get current(): T {
      return current;
    },
    handle,
    swap(next: T): void {
      const old = current;
      current = next;
      if (dispose && old !== next) {
        try {
          dispose(old);
        } catch {
          /* best-effort: no romper el swap por un fallo al limpiar la instancia vieja */
        }
      }
    },
  };
}

/**
 * Limpieza best-effort de un manager saliente, **esperando** a que termine: si
 * expone `stop`/`close`/`dispose` (zigbee/govee/meross mantienen conexiones en
 * segundo plano; los drivers de red y los de VLAN cierran su sesión SSH/SNMP
 * desde US-229), lo invoca y traga cualquier fallo o rechazo.
 *
 * Úsala donde se pueda esperar (prueba de conexión, cierre del agente); el swap
 * en caliente usa {@link disposeManager}, que no bloquea.
 */
export async function stopManager(old: unknown): Promise<void> {
  const m = old as { stop?: () => unknown; close?: () => unknown; dispose?: () => unknown };
  const fn = m.stop ?? m.close ?? m.dispose;
  if (typeof fn !== 'function') return;
  try {
    await fn.call(m);
  } catch {
    /* best-effort: cerrar una conexión ya rota no es un error que reportar */
  }
}

/**
 * Variante fire-and-forget de {@link stopManager} para el swap en caliente: no
 * se espera al cierre de la instancia saliente (nadie la usa ya) para no frenar
 * la recarga de la integración.
 */
export function disposeManager(old: unknown): void {
  void stopManager(old);
}
