import { describe, expect, it, vi } from 'vitest';
import { createTickLoop } from '../../src/system/tick-loop.js';

/**
 * US-229 / AUD3-18: los ~21 barridos del agente repetían `setInterval(() => void
 * this.tickCycle(), ms)` y **solo 2 de 21** comprobaban si el ciclo anterior
 * seguía vivo. El peor caso: `MotionService` cada 5 s invocando ffmpeg con
 * timeout de 10 s → apilamiento garantizado.
 *
 * Estos tests atan las tres garantías del helper. Sin ellos, quitar el guard de
 * re-entrada no rompería ningún test (que es exactamente cómo se llegó aquí).
 */
describe('createTickLoop (US-229)', () => {
  /** Temporizador falso: guarda el callback y lo dispara a mano. */
  function fakeTimers(): {
    timers: NonNullable<Parameters<typeof createTickLoop>[0]['timers']>;
    fire: () => void;
    cleared: () => number;
  } {
    let cb: (() => void) | null = null;
    let clears = 0;
    return {
      timers: {
        setInterval: (fn) => {
          cb = fn;
          return { unref: () => undefined };
        },
        clearInterval: () => {
          clears += 1;
          cb = null;
        },
      },
      fire: () => cb?.(),
      cleared: () => clears,
    };
  }

  it('no solapa ciclos: mientras uno está en vuelo, el siguiente se salta', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tick = vi.fn(() => gate);
    const onSkip = vi.fn();
    const { timers, fire } = fakeTimers();
    const loop = createTickLoop({ intervalMs: 1000, tick, onSkip, timers });

    loop.start();
    fire(); // ciclo 1: arranca y se queda esperando
    fire(); // ciclo 2: el 1 sigue vivo → se salta
    fire(); // ciclo 3: ídem

    expect(tick).toHaveBeenCalledTimes(1);
    expect(loop.running).toBe(true);
    expect(loop.skipped).toBe(2);
    expect(onSkip).toHaveBeenCalledTimes(2);

    release();
    await gate;
    await Promise.resolve(); // deja correr el `finally` del ciclo

    // Liberado el ciclo lento, el siguiente barrido vuelve a entrar.
    expect(loop.running).toBe(false);
    fire();
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('un ciclo que lanza se registra y no rompe el bucle', async () => {
    const boom = new Error('el driver no responde');
    const tick = vi.fn().mockRejectedValueOnce(boom).mockResolvedValue(undefined);
    const onError = vi.fn();
    const { timers, fire } = fakeTimers();
    const loop = createTickLoop({ intervalMs: 1000, tick, onError, timers });

    loop.start();
    await loop.runOnce();

    expect(onError).toHaveBeenCalledWith(boom);
    expect(loop.running).toBe(false); // el guard se libera aunque falle

    // El bucle sigue vivo: el ciclo siguiente se ejecuta con normalidad.
    fire();
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('`immediate` ejecuta un ciclo al arrancar (fija la ventana/línea base)', () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { timers } = fakeTimers();

    createTickLoop({ intervalMs: 1000, tick, immediate: true, timers }).start();

    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('arrancar dos veces no duplica el temporizador y `stop` lo limpia', () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { timers, fire, cleared } = fakeTimers();
    const loop = createTickLoop({ intervalMs: 1000, tick, timers });

    loop.start();
    loop.start(); // segunda llamada: no-op
    fire();
    expect(tick).toHaveBeenCalledTimes(1);

    loop.stop();
    expect(cleared()).toBe(1);
    loop.stop(); // idempotente
    expect(cleared()).toBe(1);
  });

  it('hace `unref()` para no mantener vivo el proceso', () => {
    const unref = vi.fn();
    const loop = createTickLoop({
      intervalMs: 1000,
      tick: vi.fn().mockResolvedValue(undefined),
      timers: { setInterval: () => ({ unref }), clearInterval: () => undefined },
    });

    loop.start();

    expect(unref).toHaveBeenCalledTimes(1);
  });
});
