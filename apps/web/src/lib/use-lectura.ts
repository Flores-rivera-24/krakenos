import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';

export interface Lectura<T> {
  /** Último dato bueno. NO se borra cuando una lectura posterior falla. */
  data: T | null;
  /** La última lectura falló. Con `data` presente, ese dato es viejo. */
  failed: boolean;
  /** Hay una lectura en vuelo y todavía no hay dato que pintar. */
  loading: boolean;
  /** Relanza la lectura. */
  reintentar: () => void;
  /** Refleja una escritura local sin volver a pedir. */
  setData: (next: T | ((prev: T | null) => T)) => void;
}

/**
 * Lectura **propia** de una pantalla que distingue tres estados que un
 * `.catch(() => setX([]))` confunde: cargando, fallo y vacío.
 *
 * Un fallo nunca borra el dato anterior: si ya había algo pintado, se conserva y
 * `failed` avisa de que está viejo (para marcarlo con `StaleBadge`); si no había
 * nada, `data` sigue en `null` y la pantalla enseña el error, nunca «sin
 * resultados». Una lista vacía de verdad llega como `data: []`.
 *
 * No cachea ni deduplica: eso es `useResource`, para lecturas **compartidas** por
 * varias pantallas. Aquí cada consumidor pide lo suyo cuando cambian `deps`.
 * `enabled: false` no pide nada (p. ej. una lectura de admin vista por otro rol).
 */
export function useLectura<T>(
  leer: () => Promise<T>,
  deps: DependencyList,
  opts: { enabled?: boolean } = {},
): Lectura<T> {
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [enVuelo, setEnVuelo] = useState(enabled);
  const [intento, setIntento] = useState(0);
  // Cambiar `deps` (no reintentar) es pedir OTRA cosa: el dato anterior es de
  // otra cosa (p. ej. otro aparato) y no se enseña mientras llega el nuevo.
  const [depsPrevias, setDepsPrevias] = useState(deps);
  if (deps.length !== depsPrevias.length || deps.some((d, i) => !Object.is(d, depsPrevias[i]))) {
    setDepsPrevias(deps);
    setData(null);
    setFailed(false);
    setEnVuelo(enabled);
  }
  // La función suele ser una lambda nueva en cada render; el efecto solo se
  // relanza con `deps`, `enabled` o `intento`.
  const leerRef = useRef(leer);
  leerRef.current = leer;

  useEffect(() => {
    if (!enabled) {
      setEnVuelo(false);
      return;
    }
    let active = true;
    setEnVuelo(true);
    leerRef
      .current()
      .then((valor) => {
        if (!active) return;
        setData(valor);
        setFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
      })
      .finally(() => {
        if (active) setEnVuelo(false);
      });
    return () => {
      active = false;
    };
    // `deps` lo decide el consumidor (el linter del repo no revisa dependencias).
  }, [...deps, enabled, intento]);

  const reintentar = useCallback(() => {
    setEnVuelo(true);
    setIntento((n) => n + 1);
  }, []);

  // Derivado, sin efecto: al pasar `enabled` a true hay un render antes de que el
  // efecto marque la petición, y en ese render no puede pintarse «vacío».
  const loading = enabled && data === null && (enVuelo || !failed);

  return { data, failed, loading, reintentar, setData };
}
