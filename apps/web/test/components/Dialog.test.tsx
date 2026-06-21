import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '@/components/ui/dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>abrir</button>
      <Dialog open={open} onClose={() => setOpen(false)} aria-label="Confirmar">
        <button onClick={() => setOpen(false)}>aceptar</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('no renderiza nada cuando open=false', () => {
    render(
      <Dialog open={false} onClose={() => {}}>
        contenido
      </Dialog>,
    );
    expect(screen.queryByText('contenido')).not.toBeInTheDocument();
  });

  it('expone role=dialog con la etiqueta accesible (aria-label)', () => {
    render(
      <Dialog open onClose={() => {}} aria-label="Confirmar acción">
        contenido
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Confirmar acción' })).toBeInTheDocument();
  });

  it('cierra con la tecla Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open onClose={onClose}>
        contenido
      </Dialog>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('cierra al hacer clic en el backdrop', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open onClose={onClose}>
        contenido
      </Dialog>,
    );
    // El backdrop es el primer hijo del overlay (aria-hidden).
    const backdrop = document.querySelector('[aria-hidden]') as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('atrapa el foco y lo devuelve al disparador al cerrar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const abrir = screen.getByRole('button', { name: 'abrir' });
    await user.click(abrir);
    // Foco movido dentro del diálogo.
    expect(screen.getByRole('button', { name: 'aceptar' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'aceptar' }));
    // Foco devuelto al disparador.
    expect(abrir).toHaveFocus();
  });
});
