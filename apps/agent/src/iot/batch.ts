/**
 * Aplicación **en paralelo pero acotada** de acciones IoT en lote (US-229).
 *
 * El problema original (AUD3-19) era el opuesto: los lotes iban en serie con 10 s
 * de timeout cada uno, así que una escena de 8 luces con el bridge caído tardaba
 * 80 s con el usuario esperando. Pero soltar un `Promise.allSettled` sobre la
 * lista entera cambia un problema por otro: una escena admite **200 acciones**
 * (`scenes.schemas.ts`), y 200 peticiones simultáneas contra un bridge Hue o un
 * zigbee2mqtt doméstico es una inundación que el usuario se hace a sí mismo.
 *
 * El punto medio es concurrencia acotada: el caso normal (una habitación, una
 * escena de pocas luces) va entero en paralelo, y un lote enorme avanza por olas
 * sin que el bridge vea más de {@link IOT_BATCH_CONCURRENCY} peticiones a la vez.
 */

/** Peticiones IoT simultáneas como máximo en un lote. */
export const IOT_BATCH_CONCURRENCY = 8;

/**
 * Como `Promise.allSettled`, pero ejecutando como mucho `limit` a la vez y
 * conservando el orden de `items` en el resultado (el reporte de fallos parciales
 * que va a la UI depende de esa correspondencia por índice).
 */
export async function settleWithLimit<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number = IOT_BATCH_CONCURRENCY,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      try {
        results[index] = { status: 'fulfilled', value: await fn(item, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
