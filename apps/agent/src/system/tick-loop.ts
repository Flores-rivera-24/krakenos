/**
 * Bucle de barrido periódico con las garantías que faltaban en los ~21 barridos
 * del agente (US-229 / AUD3-18). Hasta ahora cada servicio repetía a mano el
 * patrón `setInterval(() => void this.tickCycle(), ms)` con un `try/catch`
 * dentro, y solo 2 de 21 comprobaban si el ciclo anterior seguía vivo:
 *
 * 1. **Guard de re-entrada** — si un ciclo tarda más que el intervalo, el
 *    siguiente se **salta** en vez de solaparse. El peor caso medido: el
 *    `MotionService` corría cada 5 s invocando ffmpeg con timeout de 10 s, en
 *    serie por cámara → una cámara lenta apilaba procesos indefinidamente.
 * 2. **Captura de error** — un ciclo que lanza se registra y el bucle sigue;
 *    nunca escapa como `unhandledRejection`.
 * 3. **`unref()`** — un barrido pendiente no impide que el proceso salga.
 *
 * Lo que **no** hace, a propósito: avanzar la ventana temporal del barrido
 * (`prevTick`, `lastPollMs`, línea base). Eso es propio de cada servicio y debe
 * ocurrir **después** del `await`, para que un ciclo fallido no se coma su
 * minuto en silencio («las luces no se encendieron a las 20:00 y no hay ningún
 * error»). El helper no puede saber cuál es la ventana de cada uno.
 */
export interface TickLoop {
  /** Arranca el temporizador. Llamar dos veces no duplica el bucle. */
  start(): void;
  /** Para el temporizador. Un ciclo ya en vuelo termina por su cuenta. */
  stop(): void;
  /**
   * Ejecuta un ciclo ahora mismo respetando el guard. Devuelve `false` si se
   * saltó porque había otro en vuelo. Pensado para tests y para el ciclo
   * inmediato de arranque.
   */
  runOnce(): Promise<boolean>;
  /** `true` mientras hay un ciclo en vuelo. */
  readonly running: boolean;
  /** Ciclos saltados por solape desde que se creó el bucle. */
  readonly skipped: number;
}

export interface TickLoopOptions {
  /** Periodo del barrido en milisegundos. */
  intervalMs: number;
  /**
   * El trabajo del ciclo. Puede lanzar: el bucle lo captura. Se admite cualquier
   * valor de retorno (varios barridos devuelven la muestra que acaban de tomar).
   */
  tick: () => Promise<unknown>;
  /** Recibe el error de un ciclo fallido (normalmente `log.warn`/`log.error`). */
  onError?: (err: unknown) => void;
  /**
   * Se invoca cuando un ciclo se salta por solape. Merece la pena registrarlo:
   * es la señal de que el barrido no da abasto (hardware lento, demasiadas
   * cámaras), no un detalle interno.
   */
  onSkip?: () => void;
  /** Ejecuta un ciclo nada más arrancar (p. ej. para fijar la línea base). */
  immediate?: boolean;
  /** Temporizadores inyectables (tests). Por defecto los globales. */
  timers?: {
    setInterval: (fn: () => void, ms: number) => { unref?: () => void };
    clearInterval: (handle: never) => void;
  };
}

export function createTickLoop(opts: TickLoopOptions): TickLoop {
  const setIntervalFn = opts.timers?.setInterval ?? setInterval;
  const clearIntervalFn = opts.timers?.clearInterval ?? clearInterval;
  let handle: ReturnType<typeof setIntervalFn> | null = null;
  let running = false;
  let skipped = 0;

  async function runOnce(): Promise<boolean> {
    if (running) {
      skipped += 1;
      opts.onSkip?.();
      return false;
    }
    running = true;
    try {
      await opts.tick();
    } catch (err) {
      opts.onError?.(err);
    } finally {
      running = false;
    }
    return true;
  }

  return {
    start(): void {
      if (handle) return;
      if (opts.immediate) void runOnce();
      handle = setIntervalFn(() => void runOnce(), opts.intervalMs);
      handle.unref?.();
    },
    stop(): void {
      if (!handle) return;
      clearIntervalFn(handle as never);
      handle = null;
    },
    runOnce,
    get running(): boolean {
      return running;
    },
    get skipped(): number {
      return skipped;
    },
  };
}
