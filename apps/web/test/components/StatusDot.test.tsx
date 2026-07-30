import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusDot, type DotStatus } from '@/components/ui/status-dot';

const CASES: Array<{ status: DotStatus; cls: string }> = [
  { status: 'online', cls: 'bg-online' },
  { status: 'offline', cls: 'bg-offline' },
  { status: 'warning', cls: 'bg-warning' },
  { status: 'danger', cls: 'bg-danger' },
];

describe('StatusDot', () => {
  it.each(CASES)('renderiza la clase de color $cls para status=$status', ({ status, cls }) => {
    render(<StatusDot status={status} />);
    const dot = screen.getByRole('img');
    expect(dot).toHaveClass(cls);
    expect(dot).toHaveAttribute('data-status', status);
  });

  it('usa la etiqueta accesible por defecto del estado', () => {
    render(<StatusDot status="online" />);
    expect(screen.getByLabelText('En línea')).toBeInTheDocument();
  });

  it('permite sobreescribir la etiqueta accesible', () => {
    render(<StatusDot status="offline" label="Router caído" />);
    expect(screen.getByLabelText('Router caído')).toBeInTheDocument();
  });

  /**
   * US-235 (AUD3-26): era `role="status"`, que es una **live region**. Con 40
   * dispositivos en el inventario eso son 40 regiones anunciando cada cambio que
   * llega por socket — ruido continuo que hace la lista inservible con lector de
   * pantalla y ahoga los anuncios que sí importan (los toasts).
   */
  it('NO es una live region: un punto de estado no debe interrumpir', () => {
    render(<StatusDot status="online" />);
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
