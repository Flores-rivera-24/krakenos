import type { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

/**
 * Serializa el acceso a la ÚNICA conexión del adaptador de better-sqlite3 (US-276).
 *
 * Con Prisma 5 el motor nativo abría un pool de conexiones: una transacción tenía la
 * suya y las demás consultas del agente no la veían. El adaptador de Prisma 7 abre UNA
 * conexión (`new Database()`) y su `startTransaction` solo bloquea a otras
 * *transacciones* (un mutex interno): una consulta suelta que llegue mientras hay un
 * `BEGIN` abierto se ejecuta DENTRO de esa transacción. Si la transacción acaba en
 * `ROLLBACK` (un P2002 en un alta, un fallo a mitad de un create anidado), se lleva por
 * delante la escritura de OTRA petición, sin ningún error. Comprobado con un
 * `$transaction` interactivo que hace rollback mientras otra petición escribe
 * (`test/unit/db-client.test.ts`).
 *
 * Aquí cada consulta suelta pasa por un mutex y una transacción lo retiene de `BEGIN` a
 * `COMMIT`/`ROLLBACK`. En una sola conexión SQLite las consultas ya eran secuenciales
 * (better-sqlite3 es síncrono), así que serializar no cuesta rendimiento: solo impide el
 * entrelazado. ⚠️ Consecuencia: dentro de un `$transaction(async (tx) => …)` hay que
 * usar `tx`, nunca el cliente exterior (esperaría a que acabe la propia transacción).
 */

type Factory = InstanceType<typeof PrismaBetterSqlite3>;
type Adapter = Awaited<ReturnType<Factory['connect']>>;
type Transaction = Awaited<ReturnType<Adapter['startTransaction']>>;

/** Mutex FIFO mínimo (el `async-mutex` del adaptador va empaquetado dentro de él). */
class Mutex {
  private tail: Promise<void> = Promise.resolve();

  /** Resuelve con la función que lo libera cuando llega el turno. */
  acquire(): Promise<() => void> {
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => mine);
    return previous.then(() => release);
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Proxy que reenvía todo al original (con `this` correcto: el adaptador usa campos `#privados`). */
function forward<T extends object>(target: T, overrides: Partial<Record<keyof T, unknown>>): T {
  return new Proxy(target, {
    get(t, prop) {
      if (prop in overrides) return overrides[prop as keyof T];
      const value: unknown = Reflect.get(t, prop, t);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
    },
  });
}

function serializeAdapter(inner: Adapter): Adapter {
  const mutex = new Mutex();
  return forward(inner, {
    queryRaw: (q: Parameters<Adapter['queryRaw']>[0]) =>
      mutex.runExclusive(() => inner.queryRaw(q)),
    executeRaw: (q: Parameters<Adapter['executeRaw']>[0]) =>
      mutex.runExclusive(() => inner.executeRaw(q)),
    executeScript: (s: string) => mutex.runExclusive(() => inner.executeScript(s)),
    startTransaction: async (iso?: Parameters<Adapter['startTransaction']>[0]) => {
      const release = await mutex.acquire();
      let tx: Transaction;
      try {
        tx = await inner.startTransaction(iso);
      } catch (err) {
        release();
        throw err;
      }
      let released = false;
      const done = (): void => {
        if (!released) {
          released = true;
          release();
        }
      };
      return forward(tx, {
        commit: () => tx.commit().finally(done),
        rollback: () => tx.rollback().finally(done),
      });
    },
  });
}

/** Envuelve la fábrica del adaptador para que cada conexión salga serializada. */
export function serialized(factory: Factory): Factory {
  return forward(factory, {
    connect: async () => serializeAdapter(await factory.connect()),
    connectToShadowDb: async () => serializeAdapter(await factory.connectToShadowDb()),
  });
}
