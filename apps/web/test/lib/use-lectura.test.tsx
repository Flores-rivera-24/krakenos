import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLectura } from '@/lib/use-lectura';

afterEach(() => vi.restoreAllMocks());

describe('useLectura', () => {
  it('carga: loading true → data con el valor, failed false', async () => {
    const leer = vi.fn().mockResolvedValue([1, 2]);
    const { result } = renderHook(() => useLectura(leer, []));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toEqual([1, 2]));
    expect(result.current.failed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('fallo sin dato: failed true, data null, loading false', async () => {
    const leer = vi.fn().mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useLectura(leer, []));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('fallo tras un éxito (reintentar que falla): data conserva el valor y failed true', async () => {
    const leer = vi.fn().mockResolvedValueOnce('bueno').mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => useLectura(leer, []));
    await waitFor(() => expect(result.current.data).toBe('bueno'));
    act(() => result.current.reintentar());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.data).toBe('bueno');
    expect(result.current.loading).toBe(false);
  });

  it('reintentar tras fallo: vuelve a pedir y limpia failed al resolver', async () => {
    const leer = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useLectura(leer, []));
    await waitFor(() => expect(result.current.failed).toBe(true));
    act(() => result.current.reintentar());
    await waitFor(() => expect(result.current.data).toBe('ok'));
    expect(result.current.failed).toBe(false);
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it('reintentar que vuelve a fallar: failed sigue true y loading vuelve a false', async () => {
    const leer = vi.fn().mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useLectura(leer, []));
    await waitFor(() => expect(result.current.failed).toBe(true));
    act(() => result.current.reintentar());
    await waitFor(() => expect(leer).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.failed).toBe(true);
  });

  it('desmontar con la petición en vuelo no actualiza estado', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolver: (v: string) => void = () => {};
    const leer = vi.fn(() => new Promise<string>((r) => (resolver = r)));
    const { result, unmount } = renderHook(() => useLectura(leer, []));
    unmount();
    await act(async () => {
      resolver('tarde');
      await Promise.resolve();
    });
    expect(result.current.data).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('enabled false: no llama a leer', () => {
    const leer = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => useLectura(leer, [], { enabled: false }));
    expect(leer).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('setData actualiza data sin pedir', async () => {
    const leer = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => useLectura<number>(leer, []));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.setData((prev) => (prev ?? 0) + 10));
    expect(result.current.data).toBe(11);
    act(() => result.current.setData(5));
    expect(result.current.data).toBe(5);
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it('una respuesta vieja que llega tarde no pisa la de las deps nuevas', async () => {
    const resolvers: Record<string, (v: string) => void> = {};
    const leer = (id: string) => new Promise<string>((r) => (resolvers[id] = r));
    const { result, rerender } = renderHook(({ id }) => useLectura(() => leer(id), [id]), {
      initialProps: { id: 'a' },
    });
    rerender({ id: 'b' });
    await act(async () => {
      resolvers.b?.('de-b');
    });
    await waitFor(() => expect(result.current.data).toBe('de-b'));
    await act(async () => {
      resolvers.a?.('de-a');
    });
    expect(result.current.data).toBe('de-b');
  });

  it('enabled false→true: loading es true desde el primer render', () => {
    const leer = vi.fn(() => new Promise<number>(() => {}));
    const vistos: boolean[] = [];
    const { rerender } = renderHook(
      ({ on }) => {
        const l = useLectura(leer, [], { enabled: on });
        vistos.push(l.loading);
        return l;
      },
      { initialProps: { on: false } },
    );
    vistos.length = 0;
    rerender({ on: true });
    expect(vistos[0]).toBe(true);
  });

  it('cambio de deps: el dato anterior no se conserva y vuelve loading', async () => {
    const leer = vi.fn((id: string) =>
      id === 'a' ? Promise.resolve('de-a') : new Promise<string>(() => {}),
    );
    const { result, rerender } = renderHook(({ id }) => useLectura(() => leer(id), [id]), {
      initialProps: { id: 'a' },
    });
    await waitFor(() => expect(result.current.data).toBe('de-a'));
    rerender({ id: 'b' });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.failed).toBe(false);
  });
});
