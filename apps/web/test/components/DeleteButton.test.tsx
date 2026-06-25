import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeleteButton } from '@/components/ui/delete-button';

describe('DeleteButton', () => {
  it('muestra spinner y se deshabilita mientras la petición está en vuelo', async () => {
    let resolve!: () => void;
    const onDelete = vi.fn().mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    render(<DeleteButton onDelete={onDelete}>Eliminar</DeleteButton>);
    const btn = screen.getByRole('button', { name: 'Eliminar' });

    fireEvent.click(btn);
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
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
