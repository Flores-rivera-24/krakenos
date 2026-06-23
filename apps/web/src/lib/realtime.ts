import { useEffect, useState } from 'react';

/**
 * Antigüedad máxima de una muestra en vivo antes de considerarla obsoleta (US-94).
 * Las muestras de tráfico llegan cada ~2 s; 15 s sin novedades = datos congelados.
 */
export const STALE_AFTER_MS = 15_000;

/**
 * `true` si la última muestra es demasiado vieja. Sin muestras todavía NO es
 * obsoleto (es "esperando primera muestra"), así que devuelve `false`.
 */
export function isSampleStale(
  lastIso: string | undefined,
  nowMs: number,
  maxAgeMs = STALE_AFTER_MS,
): boolean {
  if (!lastIso) return false;
  return nowMs - new Date(lastIso).getTime() > maxAgeMs;
}

/** Reloj que re-renderiza cada `intervalMs` para reevaluar la antigüedad de las muestras. */
export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
