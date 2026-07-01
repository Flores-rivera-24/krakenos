import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Callout } from '@/components/ui/callout';

const CASES = [
  { variant: 'info', role: 'note', border: 'border-info' },
  { variant: 'success', role: 'note', border: 'border-success' },
  { variant: 'warning', role: 'note', border: 'border-warning' },
  { variant: 'danger', role: 'alert', border: 'border-danger' },
] as const;

describe('Callout', () => {
  it.each(CASES)(
    'variante $variant → role=$role con la clase $border',
    ({ variant, role, border }) => {
      render(<Callout variant={variant}>contenido</Callout>);
      const box = screen.getByRole(role);
      expect(box).toHaveClass(border);
      expect(box).toHaveTextContent('contenido');
    },
  );

  it('usa la variante info (role=note) por defecto', () => {
    render(<Callout>hola</Callout>);
    expect(screen.getByRole('note')).toHaveClass('border-info');
  });

  it('renderiza el título opcional junto al cuerpo', () => {
    render(
      <Callout variant="warning" title="Atención">
        cuerpo
      </Callout>,
    );
    expect(screen.getByText('Atención')).toBeInTheDocument();
    expect(screen.getByText('cuerpo')).toBeInTheDocument();
  });

  it('funciona sin children (solo título)', () => {
    render(<Callout variant="success" title="Todo bien" />);
    expect(screen.getByRole('note')).toHaveTextContent('Todo bien');
  });
});
