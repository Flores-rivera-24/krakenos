import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from '@/lib/use-polling';

/**
 * US-239 (AUD3-27) — **~62 peticiones/minuto en reposo** y cero coincidencias de
 * `visibilitychange` en todo `src/`: la app interrogaba al agente con la misma
 * intensidad con la pestaña en segundo plano o el móvil en el bolsillo. En un
 * servidor sobre microSD eso es justo el ruido de I/O que US-228 fue a reducir.
 */
describe('usePolling', () => {
  let visible: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    visible = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const ocultar = (v: DocumentVisibilityState) => {
    visible = v;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  };

  it('ejecuta al montar y luego en cada intervalo', () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn, 1000));

    expect(fn).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(3000));
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('SE CALLA con la pestaña oculta', () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn, 1000));
    fn.mockClear();

    ocultar('hidden');
    act(() => vi.advanceTimersByTime(10_000));

    expect(fn).not.toHaveBeenCalled(); // 10 peticiones que ya no se hacen
  });

  it('al volver refresca INMEDIATAMENTE: es cuando el usuario mira', () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn, 1000));
    ocultar('hidden');
    fn.mockClear();

    ocultar('visible');

    expect(fn).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(fn).toHaveBeenCalledTimes(2); // y reanuda el ciclo
  });

  it('`enabled: false` no sondea nada (la sidebar en móvil)', () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn, 1000, { enabled: false }));

    act(() => vi.advanceTimersByTime(5000));
    expect(fn).not.toHaveBeenCalled();
  });

  it('al desmontar deja de sondear', () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => usePolling(fn, 1000));
    fn.mockClear();

    unmount();
    act(() => vi.advanceTimersByTime(5000));

    expect(fn).not.toHaveBeenCalled();
  });

  it('una función nueva en cada render NO reinicia el intervalo', () => {
    // Sin la ref interna, cada render recrearía el `setInterval` y el sondeo se
    // desplazaría indefinidamente sin llegar a disparar.
    const fn = vi.fn();
    const { rerender } = renderHook(() => usePolling(() => fn(), 1000));
    fn.mockClear();

    rerender();
    rerender();
    act(() => vi.advanceTimersByTime(1000));

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
