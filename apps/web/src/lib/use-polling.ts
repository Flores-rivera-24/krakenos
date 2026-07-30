import { useEffect, useRef } from 'react';

/**
 * Sondeo periódico que **se calla cuando la pestaña no se ve** (US-239 / AUD3-27).
 *
 * La auditoría midió **~62 peticiones por minuto en reposo** y cero coincidencias
 * de `visibilitychange` en todo `src/`: la app seguía interrogando al agente con
 * la misma intensidad con la pestaña en segundo plano, el móvil en el bolsillo o
 * el portátil suspendiéndose. En un servidor doméstico sobre microSD eso no es
 * gratis — es justo el tipo de ruido de I/O que US-228 fue a reducir.
 *
 * Comportamiento:
 *  - Con la pestaña **visible**: ejecuta al montar y luego cada `intervalMs`.
 *  - Al **ocultarse**: para el temporizador. Nada de peticiones a nada.
 *  - Al **volver**: ejecuta **inmediatamente** (los datos están rancios: es el
 *    momento en que el usuario mira) y reanuda el ciclo.
 *
 * `enabled: false` lo apaga del todo — se usa para no sondear lo que ni siquiera
 * está en pantalla (p. ej. la barra lateral en móvil, que es `hidden md:flex`).
 */
export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  opts: { enabled?: boolean } = {},
): void {
  const enabled = opts.enabled ?? true;
  // La función suele ser una lambda nueva en cada render; se guarda en una ref
  // para no reiniciar el intervalo continuamente.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const correr = () => void fnRef.current();

    const arrancar = () => {
      if (timer !== null) return;
      correr();
      timer = setInterval(correr, intervalMs);
    };
    const parar = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') arrancar();
      else parar();
    };

    alCambiarVisibilidad();
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      parar();
    };
  }, [enabled, intervalMs]);
}
