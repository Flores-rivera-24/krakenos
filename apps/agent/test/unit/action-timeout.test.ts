import { afterEach, describe, expect, it, vi } from 'vitest';
import { withActionTimeout } from '../../src/iot/action-timeout.js';
import { IotError } from '../../src/iot/mock.iot.js';

/** Timeout por acción en la orquestación IoT (US-203 / AUD-07). */
describe('withActionTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve el resultado si la acción termina a tiempo', async () => {
    await expect(withActionTimeout(async () => 42, 1000)).resolves.toBe(42);
  });

  it('propaga el error de la acción (no lo convierte en timeout)', async () => {
    await expect(
      withActionTimeout(async () => {
        throw new IotError('IOT_NOT_FOUND', 'no existe');
      }, 1000),
    ).rejects.toMatchObject({ code: 'IOT_NOT_FOUND' });
  });

  it('una acción colgada rechaza con IOT_TIMEOUT al vencer el plazo', async () => {
    vi.useFakeTimers();
    const hung = withActionTimeout(() => new Promise<never>(() => undefined), 10_000);
    const assertion = expect(hung).rejects.toMatchObject({ code: 'IOT_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('el rechazo tardío de la acción tras el timeout se descarta en silencio', async () => {
    vi.useFakeTimers();
    let rejectLate: (err: Error) => void = () => undefined;
    const hung = withActionTimeout(
      () =>
        new Promise<never>((_, reject) => {
          rejectLate = reject;
        }),
      10_000,
    );
    const assertion = expect(hung).rejects.toMatchObject({ code: 'IOT_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    // El rechazo tardío no debe producir un unhandledRejection.
    rejectLate(new Error('tarde'));
    await vi.advanceTimersByTimeAsync(0);
  });
});
