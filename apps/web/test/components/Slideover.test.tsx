import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Slideover } from '@/components/ui/slideover';

/** Disparador + slideover controlado, para verificar la devolución de foco. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>abrir</button>
      <Slideover open={open} onClose={() => setOpen(false)} title="Detalle">
        <button>interno</button>
      </Slideover>
    </>
  );
}

describe('Slideover', () => {
  it('no renderiza nada cuando open=false', () => {
    render(
      <Slideover open={false} onClose={() => {}} title="Detalle">
        contenido
      </Slideover>,
    );
    expect(screen.queryByText('contenido')).not.toBeInTheDocument();
  });

  it('abre con título, subtítulo y contenido', () => {
    render(
      <Slideover open onClose={() => {}} title="Detalle" subtitle="sub">
        <p>contenido</p>
      </Slideover>,
    );
    expect(screen.getByText('Detalle')).toBeInTheDocument();
    expect(screen.getByText('sub')).toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });

  it('cierra con el botón X', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Slideover open onClose={onClose} title="Detalle">
        contenido
      </Slideover>,
    );
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('cierra con la tecla Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Slideover open onClose={onClose} title="Detalle">
        contenido
      </Slideover>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renderiza el footer cuando se proporciona', () => {
    render(
      <Slideover open onClose={() => {}} title="Detalle" footer={<button>Guardar</button>}>
        contenido
      </Slideover>,
    );
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
  });

  it('el diálogo se nombra por su título (aria-labelledby)', () => {
    render(
      <Slideover open onClose={() => {}} title="Detalle del dispositivo">
        contenido
      </Slideover>,
    );
    expect(screen.getByRole('dialog', { name: 'Detalle del dispositivo' })).toBeInTheDocument();
  });

  it('al abrir mueve el foco dentro del panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'abrir' }));
    // El primer elemento focusable del panel es el botón de cerrar.
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
  });

  it('atrapa el foco con Tab (cicla del último al primero)', async () => {
    const user = userEvent.setup();
    render(
      <Slideover open onClose={() => {}} title="Detalle" footer={<button>Guardar</button>}>
        <button>interno</button>
      </Slideover>,
    );
    const cerrar = screen.getByRole('button', { name: 'Cerrar' });
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    guardar.focus();
    await user.tab(); // desde el último → vuelve al primero
    expect(cerrar).toHaveFocus();
    await user.tab({ shift: true }); // desde el primero → salta al último
    expect(guardar).toHaveFocus();
  });

  it('devuelve el foco al disparador al cerrar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const abrir = screen.getByRole('button', { name: 'abrir' });
    await user.click(abrir);
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(abrir).toHaveFocus();
  });
});
