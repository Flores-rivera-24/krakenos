import { describe, expect, it } from 'vitest';
import { IOT_BATCH_CONCURRENCY, settleWithLimit } from '../../src/iot/batch.js';

/**
 * US-229 / AUD3-19: los lotes IoT pasan de serie a paralelo **acotado**. La cota
 * no es cosmética: una escena admite 200 acciones y sin límite serían 200
 * peticiones simultáneas contra el bridge del hogar.
 */
describe('settleWithLimit (US-229)', () => {
  it('nunca ejecuta más de `limit` a la vez y las ejecuta todas', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const done: number[] = [];

    await settleWithLimit(
      Array.from({ length: 25 }, (_, i) => i),
      async (n) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        done.push(n);
        inFlight -= 1;
      },
      4,
    );

    expect(maxInFlight).toBe(4);
    expect(done).toHaveLength(25);
  });

  it('conserva el orden de entrada en el resultado (el reporte va por índice)', async () => {
    // El más lento va primero a propósito: si el resultado se acumulara por orden
    // de terminación, el fallo se atribuiría al dispositivo equivocado en la UI.
    const outcomes = await settleWithLimit(['lento', 'rápido', 'roto'], async (id) => {
      if (id === 'lento') await new Promise((r) => setTimeout(r, 20));
      if (id === 'roto') throw new Error('no responde');
      return id.toUpperCase();
    });

    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled', 'rejected']);
    expect(outcomes[0]).toMatchObject({ value: 'LENTO' });
    expect(outcomes[2]).toMatchObject({ reason: expect.objectContaining({ message: 'no responde' }) });
  });

  it('un fallo no aborta el resto del lote (best-effort, como el bucle original)', async () => {
    const outcomes = await settleWithLimit([1, 2, 3], async (n) => {
      if (n === 1) throw new Error('caído');
      return n;
    });

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(2);
  });

  it('lista vacía → resultado vacío, sin trabajadores', async () => {
    await expect(settleWithLimit([], async () => 1)).resolves.toEqual([]);
  });

  it('la cota por defecto deja pasar de largo una habitación normal', () => {
    expect(IOT_BATCH_CONCURRENCY).toBeGreaterThanOrEqual(8);
  });
});
