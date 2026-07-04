import { describe, expect, it } from 'vitest';
import { HeatmapCache } from '../../src/coverage/heatmap-cache.js';

/** Promesa resoluble a mano, para controlar el orden de los cálculos en curso. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('HeatmapCache', () => {
  it('memoiza por clave: el segundo get NO recalcula', async () => {
    const cache = new HeatmapCache<number>();
    let calls = 0;
    const compute = () => {
      calls++;
      return Promise.resolve(42);
    };

    expect(await cache.get('k', compute)).toBe(42);
    expect(await cache.get('k', compute)).toBe(42);
    expect(calls).toBe(1); // solo se calculó una vez
  });

  it('single-flight: peticiones concurrentes de la misma clave comparten un cálculo', async () => {
    const cache = new HeatmapCache<number>();
    let calls = 0;
    const d = deferred<number>();
    const compute = () => {
      calls++;
      return d.promise;
    };

    const a = cache.get('k', compute);
    const b = cache.get('k', compute);
    d.resolve(7);

    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(calls).toBe(1); // un solo cálculo para ambas
  });

  it('claves distintas se calculan por separado', async () => {
    const cache = new HeatmapCache<string>();
    expect(await cache.get('a', () => Promise.resolve('A'))).toBe('A');
    expect(await cache.get('b', () => Promise.resolve('B'))).toBe('B');
  });

  it('un cálculo que lanza NO se memoiza (el siguiente reintenta)', async () => {
    const cache = new HeatmapCache<number>();
    let calls = 0;
    await expect(
      cache.get('k', () => {
        calls++;
        return Promise.reject(new Error('boom'));
      }),
    ).rejects.toThrow('boom');
    // La clave no quedó memoizada: el siguiente get recalcula (y ahora resuelve).
    expect(await cache.get('k', () => {
      calls++;
      return Promise.resolve(1);
    })).toBe(1);
    expect(calls).toBe(2);
  });

  it('LRU: al superar maxEntries evicciona la entrada menos usada recientemente', async () => {
    const cache = new HeatmapCache<number>(2); // capacidad 2
    const compute = (v: number) => () => Promise.resolve(v);

    await cache.get('a', compute(1));
    await cache.get('b', compute(2));
    // Toca 'a' para que 'b' pase a ser la menos reciente.
    await cache.get('a', compute(99)); // hit → sigue 1, no recalcula
    // Inserta 'c': debe eviccionar 'b' (la menos reciente), no 'a'.
    await cache.get('c', compute(3));

    let recomputedA = false;
    let recomputedB = false;
    expect(
      await cache.get('a', () => {
        recomputedA = true;
        return Promise.resolve(-1);
      }),
    ).toBe(1); // 'a' seguía en caché → no recalcula
    expect(
      await cache.get('b', () => {
        recomputedB = true;
        return Promise.resolve(-2);
      }),
    ).toBe(-2); // 'b' fue eviccionada → recalcula
    expect(recomputedA).toBe(false);
    expect(recomputedB).toBe(true);
  });

  it('límite de concurrencia: no corren más de maxConcurrent cálculos a la vez', async () => {
    const cache = new HeatmapCache<number>(32, 2); // máx 2 en paralelo
    let active = 0;
    let peak = 0;
    let started = 0;
    // Gates creados POR ADELANTADO (índice = clave), para no depender del orden
    // de microtasks: cada cómputo espera su gate y el test los abre a voluntad.
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];

    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setImmediate(r));
      if (!cond()) throw new Error('condición no alcanzada a tiempo');
    };

    const launch = (i: number) =>
      cache.get(`k${i}`, async () => {
        started++;
        active++;
        peak = Math.max(peak, active);
        await gates[i]!.promise;
        active--;
        return i;
      });

    const all = [launch(0), launch(1), launch(2), launch(3)];

    // Solo 2 deben haber arrancado; los otros 2 esperan slot.
    await until(() => started === 2);
    expect(active).toBe(2);

    // Libera los dos primeros → los dos en cola arrancan.
    gates[0]!.resolve();
    gates[1]!.resolve();
    await until(() => started === 4);
    gates[2]!.resolve();
    gates[3]!.resolve();

    expect(await Promise.all(all)).toEqual([0, 1, 2, 3]);
    expect(peak).toBeLessThanOrEqual(2); // nunca más de 2 simultáneos
  });
});
