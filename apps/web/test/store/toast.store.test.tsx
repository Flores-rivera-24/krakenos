import { beforeEach, describe, expect, it } from 'vitest';
import { toast, useToastStore } from '@/store/toast.store';

describe('toast.store', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it('encola toasts de éxito y error con su tipo', () => {
    toast.success('guardado');
    toast.error('falló');
    const { toasts } = useToastStore.getState();
    expect(toasts.map((t) => t.kind)).toEqual(['success', 'error']);
    expect(toasts.map((t) => t.message)).toEqual(['guardado', 'falló']);
  });

  it('descarta por id sin tocar el resto', () => {
    toast.info('a');
    toast.info('b');
    const [first] = useToastStore.getState().toasts;
    useToastStore.getState().dismiss(first!.id);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['b']);
  });
});

/**
 * US-235 (AUD3-26) — **la live region tiene que existir ANTES del contenido.**
 *
 * `Toaster` hacía `if (toasts.length === 0) return null` por encima del
 * contenedor con `aria-live`, así que la región nacía junto con su primer toast.
 * Los lectores de pantalla solo anuncian cambios de una región que **ya existía**,
 * de modo que ninguna confirmación de escritura se anunciaba jamás: ni «Regla
 * creada», ni «Dispositivo bloqueado», ni un error revertido.
 */
describe('Toaster: live region (US-235)', () => {
  it('el contenedor aria-live está en el DOM aunque no haya toasts', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { Toaster } = await import('@/components/ui/toast');
    useToastStore.setState({ toasts: [] });

    const { container } = render(<Toaster />);

    const region = container.querySelector('[aria-live]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('button')).toBeNull(); // vacío, sin ocupar nada
  });
});
