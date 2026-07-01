import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GlossaryHint } from '@/components/ui/glossary-hint';
import { getGlossaryEntry } from '@/lib/guides';

describe('GlossaryHint', () => {
  it('deriva la etiqueta accesible del término del glosario', () => {
    render(<GlossaryHint termKey="ssid" />);
    expect(screen.getByRole('button', { name: '¿Qué es SSID?' })).toBeInTheDocument();
  });

  it('al abrirlo revela la definición corta del glosario', () => {
    render(<GlossaryHint termKey="ssid" />);
    fireEvent.click(screen.getByRole('button', { name: '¿Qué es SSID?' }));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent(getGlossaryEntry('ssid')!.short);
  });

  it('usa el texto de reserva cuando la clave no existe', () => {
    render(<GlossaryHint termKey="no-existe" fallback="Explicación llana" />);
    const trigger = screen.getByRole('button', { name: 'Más información' });
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Explicación llana');
  });

  it('no renderiza nada si la clave no existe y no hay reserva', () => {
    const { container } = render(<GlossaryHint termKey="no-existe" />);
    expect(container).toBeEmptyDOMElement();
  });
});
