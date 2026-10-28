import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/toast';
import { useToastStore } from '@/store/toast.store';

/**
 * W2-24 — un toast de error dura más que uno de éxito y no se va mientras la
 * persona lo lee (puntero encima o foco dentro).
 */
describe('Toaster: duración y pausa', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useRealTimers();
  });

  const avanzar = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const empujar = (kind: 'success' | 'error', msg: string) =>
    act(() => useToastStore.getState().push(kind, msg));
  const caja = (msg: string) => screen.getByText(msg).parentElement as HTMLElement;

  it('un toast de éxito se va a los 4 s', () => {
    render(<Toaster />);
    empujar('success', 'Guardado');
    avanzar(3999);
    expect(screen.queryByText('Guardado')).not.toBeNull();
    avanzar(2);
    expect(screen.queryByText('Guardado')).toBeNull();
  });

  it('uno de error sigue a los 9 s y se va a los 10 s', () => {
    render(<Toaster />);
    empujar('error', 'Falló');
    avanzar(9000);
    expect(screen.queryByText('Falló')).not.toBeNull();
    avanzar(1001);
    expect(screen.queryByText('Falló')).toBeNull();
  });

  it('con el puntero encima no se va aunque pasen 30 s', () => {
    render(<Toaster />);
    empujar('error', 'Falló');
    fireEvent.mouseEnter(caja('Falló'));
    avanzar(30000);
    expect(screen.queryByText('Falló')).not.toBeNull();
  });

  it('al salir el puntero se va con el tiempo que le quedaba', () => {
    render(<Toaster />);
    empujar('error', 'Falló');
    avanzar(9000);
    fireEvent.mouseEnter(caja('Falló'));
    avanzar(21000);
    expect(screen.queryByText('Falló')).not.toBeNull();
    fireEvent.mouseLeave(caja('Falló'));
    avanzar(900);
    expect(screen.queryByText('Falló')).not.toBeNull();
    avanzar(200);
    expect(screen.queryByText('Falló')).toBeNull();
  });

  it('con el foco dentro (botón descartar enfocado) tampoco se va', () => {
    render(<Toaster />);
    empujar('error', 'Falló');
    const boton = screen.getByRole('button');
    fireEvent.focusIn(boton);
    avanzar(30000);
    expect(screen.queryByText('Falló')).not.toBeNull();
    fireEvent.focusOut(boton, { relatedTarget: null });
    avanzar(10001);
    expect(screen.queryByText('Falló')).toBeNull();
  });
});
