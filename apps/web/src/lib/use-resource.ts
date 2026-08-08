import { useCallback, useEffect, useRef, useState } from 'react';
import { usePolling } from '@/lib/use-polling';

/**
 * Lectura compartida con **caché por clave** y **single-flight** (US-262).
 *
 * El dashboard abría pidiendo **20 veces** al agente, y tres de esas peticiones
 * eran la misma: `/iot/devices` la piden a la vez `QuickActionsWidget`,
 * `IotStatusWidget` y la barra lateral, cada uno con su `useEffect`, su `useState`
 * y su propio `catch`. Otro tanto con `/scenes` (×2) y `/system/stats` (×2).
 * Ninguno sabe de los otros, así que el agente —que corre en una Raspberry sobre
 * microSD— contesta tres veces lo mismo en el mismo tick, y la app se pinta con
 * tres copias del mismo dato que pueden diferir entre sí.
 *
 * Este hook resuelve las dos mitades del problema, que son distintas:
 *
 *  - **Single-flight**: si ya hay una petición en vuelo para esa clave, el que
 *    llega se **engancha a la que hay** en vez de abrir otra. Es lo que colapsa
 *    la ráfaga de arranque, donde los tres consumidores montan en el mismo tick.
 *  - **Caché con TTL**: dentro de la ventana, montar de nuevo no vuelve a pedir.
 *    Es lo que cubre volver a una página que se acaba de dejar, y a los widgets
 *    `lazy()` que llegan un tick más tarde que sus vecinos.
 *
 * ## Lo que este hook NO hace, a propósito
 *
 * **No degrada un fallo a un valor vacío.** El `catch(() => [])` que había en
 * varios consumidores es justo la mentira que US-234 quitó de `IotStatusWidget`:
 * un agente caído se leía como «no tienes dispositivos IoT». Aquí el fallo viaja
 * en `error` y decide el consumidor —con `WidgetError`, con un vacío honesto o
 * como le toque—, porque esa decisión es de presentación y cambia según el sitio.
 *
 * **No cachea el error.** Un valor se guarda con su instante; un fallo no. Si la
 * petición falla, la siguiente vuelve a intentarlo en vez de quedarse con el
 * fallo pegado durante todo el TTL — que es como una caída de red de un segundo
 * se convierte en un widget roto durante un minuto. La ráfaga simultánea la
 * cubre igual el single-flight, que es lo que había que arreglar.
 *
 * **No sondea por su cuenta.** Si se le pasa `pollMs` delega en `usePolling`
 * (invariante del proyecto: todo sondeo se calla con la pestaña oculta), y ese
 * sondeo **fuerza** la lectura saltándose el TTL — si no, un sondeo cada 8 s
 * contra un TTL de 5 s devolvería caché la mitad de las veces y la barra lateral
 * enseñaría datos viejos sin decirlo.
 *
 * ## La clave determina el fetcher
 *
 * Dos consumidores con la misma clave comparten resultado, así que la clave
 * —que es la ruta— tiene que determinar por completo **qué se pide**. Una clave
 * con parámetros los lleva dentro (`/presence/timeline?limit=5`), nunca fuera.
 */

/** Estado observable de un recurso. La identidad del objeto solo cambia con el contenido. */
export interface EstadoRecurso<T> {
  /** El dato, o `null` mientras no haya ninguno cargado. */
  data: T | null;
  /** El fallo de la última lectura, o `null`. Un dato viejo NO se borra al fallar. */
  error: unknown;
  /** `true` mientras hay una lectura en vuelo y todavía no hay dato que enseñar. */
  loading: boolean;
}

interface Entrada<T> {
  estado: EstadoRecurso<T>;
  /** Instante en que se guardó `estado.data`. `0` = nunca hubo dato. */
  guardadoEn: number;
  /** Lectura en vuelo, si la hay. Es lo que hace el single-flight. */
  enVuelo: Promise<unknown> | null;
  suscriptores: Set<() => void>;
}

/**
 * Ventana de caché por defecto: **5 s**.
 *
 * No es un número redondo elegido a ojo. Sale de acotarlo por los dos lados:
 *  - Por abajo, la ráfaga de arranque del dashboard dura **milisegundos**, pero
 *    los widgets `lazy()` (Tráfico y Topología) llegan en un tick posterior, así
 *    que un TTL de cero dejaría fuera justo a los que se separaron para pesar
 *    menos.
 *  - Por arriba, el sondeo más rápido que hay sobre estos datos es el de la
 *    barra lateral, a **8 s** (`useSidebarStats`). Quedarse por debajo garantiza
 *    que la caché nunca es la razón por la que un dato es más viejo de lo que ya
 *    acepta la pantalla que lo enseña.
 */
export const TTL_RECURSO_MS = 5_000;

const cache = new Map<string, Entrada<unknown>>();

const VACIO: EstadoRecurso<never> = { data: null, error: null, loading: false };

function entrada<T>(clave: string): Entrada<T> {
  let e = cache.get(clave);
  if (!e) {
    e = { estado: VACIO, guardadoEn: 0, enVuelo: null, suscriptores: new Set() };
    cache.set(clave, e);
  }
  return e as Entrada<T>;
}

function publicar<T>(e: Entrada<T>, estado: EstadoRecurso<T>): void {
  e.estado = estado;
  for (const avisar of e.suscriptores) avisar();
}

/**
 * Lee una clave respetando caché y single-flight.
 *
 * `forzar` salta el TTL (lo usa el sondeo y el `refetch()` manual), pero **no**
 * salta el single-flight: si ya hay una lectura en vuelo se engancha a ella. Dos
 * sondeos que se solapan no tienen por qué convertirse en dos peticiones.
 */
function leer<T>(clave: string, fetcher: () => Promise<T>, forzar: boolean): Promise<void> {
  const e = entrada<T>(clave);

  if (e.enVuelo) return e.enVuelo.then(() => undefined);
  if (!forzar && e.guardadoEn !== 0 && Date.now() - e.guardadoEn < TTL_RECURSO_MS) {
    return Promise.resolve();
  }

  // Solo se anuncia «cargando» si no hay nada que enseñar todavía. Con dato
  // previo, una relectura de fondo no debe devolver la pantalla al esqueleto.
  if (e.estado.data === null) {
    publicar(e, { data: null, error: e.estado.error, loading: true });
  }

  const vuelo = fetcher()
    .then((valor) => {
      e.guardadoEn = Date.now();
      publicar(e, { data: valor, error: null, loading: false });
    })
    .catch((err: unknown) => {
      // El fallo NO se guarda con instante: la próxima lectura reintenta.
      // Y el dato previo se conserva — perderlo convertiría un fallo puntual
      // del sondeo en un widget que se vacía solo.
      publicar(e, { data: e.estado.data, error: err, loading: false });
    })
    .finally(() => {
      e.enVuelo = null;
    });

  e.enVuelo = vuelo;
  return vuelo;
}

/**
 * Invalida una clave: la próxima lectura vuelve a pedir aunque el TTL siga vivo.
 *
 * Es lo que hay que llamar **después de una mutación** que cambia ese recurso
 * (crear una escena, borrar una habitación). Sin esto, la caché haría que la
 * lista siguiera enseñando el estado de antes de la escritura durante el TTL, que
 * es el defecto clásico de meter una caché: la app deja de reflejar lo que el
 * propio usuario acaba de hacer.
 */
export function invalidarRecurso(clave: string): void {
  const e = cache.get(clave);
  if (e) e.guardadoEn = 0;
}

/**
 * Vacía la caché entera. Dos usos, los dos legítimos:
 *  - **Al cerrar sesión**: los datos del hogar de una sesión no pueden sobrevivir
 *    a la siguiente en un panel con roles sobre un dispositivo compartido, que es
 *    el mismo razonamiento por el que el service worker no cachea `/api`.
 *  - **Entre tests**: la caché vive en el módulo, así que sin esto el resultado
 *    de un test se filtraría al siguiente y el orden decidiría quién pasa.
 */
export function limpiarRecursos(): void {
  cache.clear();
}

export interface OpcionesRecurso {
  /** `false` no pide nada (p. ej. la barra lateral, que en móvil ni se pinta). */
  enabled?: boolean;
  /** Si se indica, resondea cada N ms **forzando** la lectura, vía `usePolling`. */
  pollMs?: number;
}

/**
 * Suscribe un componente a una clave, pidiéndola si hace falta.
 *
 * Devuelve el estado compartido de esa clave y un `refetch()` que fuerza la
 * relectura (para «Reintentar» y para después de escribir).
 */
export function useResource<T>(
  clave: string,
  fetcher: () => Promise<T>,
  opts: OpcionesRecurso = {},
): EstadoRecurso<T> & { refetch: () => Promise<void> } {
  const { enabled = true, pollMs } = opts;

  // El fetcher suele ser una lambda nueva en cada render; guardarlo en una ref
  // evita reiniciar el efecto continuamente (mismo patrón que `usePolling`).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // El estado se lee del caché **en cada render**, no de un `useState` propio: si
  // se copiara al montar, un cambio de `clave` (un slideover que pasa de un
  // aparato a otro) enseñaría durante un frame el dato del anterior — que no es
  // un retraso, es enseñar la medida de otro. La suscripción solo sirve para
  // provocar el re-render cuando la entrada compartida cambia.
  const e = entrada<T>(clave);
  const [, redibujar] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const ent = entrada<T>(clave);
    const avisar = () => redibujar((n) => n + 1);
    ent.suscriptores.add(avisar);
    void leer(clave, () => fetcherRef.current(), false);
    return () => {
      ent.suscriptores.delete(avisar);
    };
  }, [clave, enabled]);

  const refetch = useCallback(() => leer(clave, () => fetcherRef.current(), true), [clave]);

  // El sondeo fuerza: si respetara el TTL, la mitad de los ciclos no pediría nada
  // y la pantalla enseñaría datos más viejos que su propia cadencia declarada.
  // El intervalo de relleno no llega a usarse (`enabled` es false sin `pollMs`);
  // está para que un futuro descuido no acabe en un `setInterval(fn, 0)`.
  usePolling(refetch, pollMs ?? 60_000, { enabled: enabled && pollMs !== undefined });

  return { ...e.estado, refetch };
}
