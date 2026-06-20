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
    const dot = screen.getByRole('status');
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
});
