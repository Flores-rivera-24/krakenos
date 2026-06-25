import { useRef, useState } from 'react';

interface Options {
  /** Valor "verdad" del servidor (prop/store/socket). Si cambia, manda él. */
  value: boolean;
  /** Aplica el cambio en el servidor. Si rechaza, la UI revierte. */
  mutate: (next: boolean) => Promise<unknown>;
  onError?: (err: unknown) => void;
  onSuccess?: (next: boolean) => void;
}

interface OptimisticToggle {
  /** Valor a pintar: el optimista mientras va la petición, si no la verdad. */
  on: boolean;
  pending: boolean;
  toggle: () => Promise<void>;
}

/**
 * Toggle optimista con reversión (US-96). Al alternar, la UI se mueve **ya** y la
 * petición sale en segundo plano; si rechaza, vuelve al valor previo y avisa por
 * `onError` — nunca miente sobre el estado real (mismo criterio de revert de US-55).
 *
 * El `value` del servidor manda: si cambia (p. ej. un `iot:device-updated` por
 * socket, o un reload tras guardar), se adopta y se descarta cualquier optimismo.
 */
export function useOptimisticToggle({ value, mutate, onError, onSuccess }: Options): OptimisticToggle {
  const [optimistic, setOptimistic] = useState(value);
  const [pending, setPending] = useState(false);
  const lastValue = useRef(value);

  // Adopta la verdad del servidor cuando cambia (patrón de estado derivado de
  // React: ajustar en render evita un useEffect de sincronización innecesario).
  if (value !== lastValue.current) {
    lastValue.current = value;
    setOptimistic(value);
  }

  const toggle = async () => {
    if (pending) return;
    const next = !optimistic;
    const previous = optimistic;
    setOptimistic(next);
    setPending(true);
    try {
      await mutate(next);
      onSuccess?.(next);
    } catch (err) {
      setOptimistic(previous); // revertir: no mentir sobre el estado real
      onError?.(err);
    } finally {
      setPending(false);
    }
  };

  return { on: optimistic, pending, toggle };
}
