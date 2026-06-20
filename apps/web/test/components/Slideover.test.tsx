import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Slideover } from '@/components/ui/slideover';

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
});
