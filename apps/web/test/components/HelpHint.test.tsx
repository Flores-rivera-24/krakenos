import { fireEvent, render, screen } from '@testing-library/react';
import { configureAxe, toHaveNoViolations } from 'jest-axe';
import { describe, expect, it } from 'vitest';
import { HelpHint } from '@/components/ui/help-hint';

expect.extend(toHaveNoViolations);
const axe = configureAxe({
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
});

describe('HelpHint', () => {
  it('tiene etiqueta accesible por defecto y arranca cerrado', () => {
    render(<HelpHint content="Explicación" />);
    const trigger = screen.getByRole('button', { name: 'Más información' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('acepta una etiqueta personalizada', () => {
    render(<HelpHint content="c" label="¿Qué es un SSID?" />);
    expect(screen.getByRole('button', { name: '¿Qué es un SSID?' })).toBeInTheDocument();
  });

  it('abre/cierra con clic (toggle) y asocia la burbuja por aria-describedby', () => {
    render(<HelpHint content="Qué es esto" />);
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Qué es esto');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-describedby', tip.id);
    fireEvent.click(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cierra con Escape', () => {
    render(<HelpHint content="c" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('abre al enfocar y cierra al perder el foco', () => {
    render(<HelpHint content="c" />);
    const trigger = screen.getByRole('button');
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('abre al pasar el ratón y cierra al salir', () => {
    render(<HelpHint content="c" />);
    const container = screen.getByRole('button').parentElement as HTMLElement;
    fireEvent.mouseEnter(container);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(container);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cierra al hacer clic fuera', () => {
    render(
      <>
        <HelpHint content="c" />
        <button>fuera</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Más información' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'fuera' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('envuelve children como disparador (sin aria-label propio)', () => {
    render(
      <HelpHint content="def">
        <span>SSID</span>
      </HelpHint>,
    );
    const trigger = screen.getByRole('button', { name: 'SSID' });
    expect(trigger).not.toHaveAttribute('aria-label');
  });

  it('coloca la burbuja arriba por defecto y abajo con placement="bottom"', () => {
    const { rerender } = render(<HelpHint content="c" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toHaveClass('bottom-full');
    rerender(<HelpHint content="c" placement="bottom" />);
    expect(screen.getByRole('tooltip')).toHaveClass('top-full');
  });

  it('no tiene violaciones axe estando abierto', async () => {
    const { container } = render(<HelpHint content="Explicación clara del término" />);
    fireEvent.click(screen.getByRole('button'));
    expect(await axe(container)).toHaveNoViolations();
  });
});
