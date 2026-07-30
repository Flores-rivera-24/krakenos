import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeleteButton } from '@/components/ui/delete-button';

describe('DeleteButton', () => {
  /**
   * US-235 (AUD3-29): la auditoría contó 11 borrados que no confirmaban nada — un
   * toque y el peer de VPN o la regla de firewall desaparecían. La confirmación
   * vive en el componente compartido, así que cubre los once.
   */
  describe('confirmación de dos pasos', () => {
    it('el primer click NO borra: pide confirmar', () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(<DeleteButton onDelete={onDelete}>Eliminar</DeleteButton>);

      fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    });

    it('el segundo click sí borra', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(<DeleteButton onDelete={onDelete}>Eliminar</DeleteButton>);

      fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

      await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    });

    it('«Cancelar» vuelve atrás sin borrar', () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(<DeleteButton onDelete={onDelete}>Eliminar</DeleteButton>);

      fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
    });

    it('el foco pasa a «Confirmar» para no perder al usuario de teclado', () => {
      render(<DeleteButton onDelete={() => Promise.resolve()}>Eliminar</DeleteButton>);
      fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

      expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveFocus();
    });

    it('se desarma solo: un click distraído un minuto después no borra', () => {
      vi.useFakeTimers();
      try {
        const onDelete = vi.fn().mockResolvedValue(undefined);
        render(<DeleteButton onDelete={onDelete}>Eliminar</DeleteButton>);
        fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

        act(() => {
          vi.advanceTimersByTime(6000);
        });

        expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
        expect(onDelete).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('`skipConfirm` borra directo (solo para lo trivial y reversible)', async () => {
      const onDelete = vi.fn().mockResolvedValue(undefined);
      render(
        <DeleteButton onDelete={onDelete} skipConfirm>
          Quitar
        </DeleteButton>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
      await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    });
  });

  it('muestra spinner y se deshabilita mientras la petición está en vuelo', async () => {
    let resolve!: () => void;
    const onDelete = vi.fn().mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    render(<DeleteButton onDelete={onDelete}>Eliminar</DeleteButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    const btn = await screen.findByRole('button', { name: 'Eliminar' });
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute('aria-busy', 'true');

    // Un segundo click no relanza la acción mientras está pendiente.
    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledTimes(1);

    resolve();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it('no propaga el click a la fila contenedora', () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <DeleteButton onDelete={() => Promise.resolve()}>Eliminar</DeleteButton>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
