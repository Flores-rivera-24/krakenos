/** Tope por defecto del cierre ordenado: bastante menos que el `TimeoutStopSec` de systemd (90 s). */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Tope del `$disconnect()` de la base una vez agotado el del cierre. */
export const DISCONNECT_TIMEOUT_MS = 3_000;

/** Lo mínimo que el cierre necesita de la aplicación (compatible con `FastifyInstance`). */
export interface ShutdownApp {
  close(): PromiseLike<unknown>;
  prisma?: { $disconnect(): PromiseLike<unknown> };
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(obj: object, msg: string): void;
  };
}

export interface ShutdownDeps {
  app: ShutdownApp;
  /** Tope para `app.close()`; pasado, se fuerza el cierre de la base y se sale con 1. */
  timeoutMs?: number;
  exit: (code: number) => void;
}

/**
 * Crea el cierre del proceso: `app.close()` con un TOPE. Sin él, una conexión que
 * `close()` no consigue cerrar dejaba al agente vivo hasta que systemd o Docker
 * mandaban `SIGKILL` —a media escritura de SQLite, que es justo lo que el cierre
 * ordenado existe para evitar—. Si se agota el tope se intenta al menos cerrar la
 * base (vuelca el WAL) y se sale con un código distinto de 0.
 *
 * Es idempotente: una segunda señal con el cierre en curso no lo reinicia.
 */
export function createShutdown(
  deps: ShutdownDeps,
): (reason: string, exitCode?: number) => Promise<void> {
  const { app, exit } = deps;
  const timeoutMs = deps.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  let enCurso: Promise<void> | null = null;

  const cerrar = async (reason: string, exitCode: number): Promise<void> => {
    app.log.info(`Recibido ${reason}, cerrando…`);
    let timer: NodeJS.Timeout | undefined;
    const tope = new Promise<'tope'>((resolve) => {
      timer = setTimeout(() => resolve('tope'), timeoutMs);
    });
    const cierre = Promise.resolve(app.close()).then(
      () => 'cerrado' as const,
      (err: unknown) => {
        app.log.error({ err }, 'Error al cerrar el agente');
        return 'error' as const;
      },
    );
    const resultado = await Promise.race([cierre, tope]);
    clearTimeout(timer);

    if (resultado === 'cerrado') {
      exit(exitCode);
      return;
    }
    if (resultado === 'tope') {
      app.log.warn(
        `El cierre no terminó en ${timeoutMs} ms (queda alguna conexión o tarea viva); se cierra la base y se sale a la fuerza.`,
      );
      try {
        // También acotado: si la base no responde, no se puede quedar aquí colgado.
        await Promise.race([
          app.prisma?.$disconnect(),
          new Promise<void>((resolve) => setTimeout(resolve, DISCONNECT_TIMEOUT_MS)),
        ]);
      } catch (err) {
        app.log.error({ err }, 'No se pudo cerrar la base tras el tope del cierre');
      }
    }
    exit(1);
  };

  return (reason, exitCode = 0) => (enCurso ??= cerrar(reason, exitCode));
}

/**
 * Señales que piden cerrar el proceso (US-280). `SIGINT` es Ctrl+C —en Windows, además,
 * lo que el administrador de servicios envuelto manda para parar— y `SIGTERM` es systemd o
 * Docker. `SIGBREAK` es la que Windows envía al cerrar la consola o con Ctrl+Pausa; en
 * Linux no existe y registrar un manejador sería ruido.
 */
export function shutdownSignals(platform: NodeJS.Platform = process.platform): NodeJS.Signals[] {
  return platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM'];
}
