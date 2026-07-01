import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GlossaryTerm } from '@/components/ui/glossary-term';

describe('GlossaryTerm', () => {
  it('muestra el término subrayado y revela la definición al hacer clic', () => {
    render(
      <GlossaryTerm term="SSID" definition="El nombre de tu red WiFi.">
        SSID
      </GlossaryTerm>,
    );
    const trigger = screen.getByRole('button', { name: 'SSID' });
    expect(trigger).toHaveClass('underline', 'decoration-dotted');
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('El nombre de tu red WiFi.');
  });

  it('usa `term` como texto visible si no hay children', () => {
    render(<GlossaryTerm term="CIDR" definition="Notación de rango de IPs." />);
    expect(screen.getByRole('button', { name: 'CIDR' })).toBeInTheDocument();
  });
});
