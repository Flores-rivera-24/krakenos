import { fireEvent, render, screen } from '@testing-library/react';
import { configureAxe, toHaveNoViolations } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import { Accordion, AccordionItem } from '@/components/ui/accordion';

expect.extend(toHaveNoViolations);
const axe = configureAxe({
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
});

function Sample({ type }: { type?: 'single' | 'multiple' }) {
  return (
    <Accordion type={type}>
      <AccordionItem id="a" title="Sección A">
        Contenido A
      </AccordionItem>
      <AccordionItem id="b" title="Sección B">
        Contenido B
      </AccordionItem>
    </Accordion>
  );
}

describe('Accordion', () => {
  it('arranca colapsado; expandir muestra el panel y marca aria-expanded', () => {
    render(<Sample />);
    const header = screen.getByRole('button', { name: 'Sección A' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(header.getAttribute('aria-controls') ?? '');
    expect(panel).toHaveAttribute('hidden');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('hidden');
  });

  it('asocia el panel (region) con su encabezado', () => {
    render(<Sample />);
    const header = screen.getByRole('button', { name: 'Sección A' });
    fireEvent.click(header);
    const region = screen.getByRole('region', { name: 'Sección A' });
    expect(region.id).toBe(header.getAttribute('aria-controls'));
  });

  it('type="single": abrir una cierra la otra', () => {
    render(<Sample type="single" />);
    const a = screen.getByRole('button', { name: 'Sección A' });
    const b = screen.getByRole('button', { name: 'Sección B' });
    fireEvent.click(a);
    expect(a).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(b);
    expect(b).toHaveAttribute('aria-expanded', 'true');
    expect(a).toHaveAttribute('aria-expanded', 'false');
  });

  it('type="multiple": varias secciones abiertas a la vez y toggle para cerrar', () => {
    render(<Sample type="multiple" />);
    const a = screen.getByRole('button', { name: 'Sección A' });
    const b = screen.getByRole('button', { name: 'Sección B' });
    fireEvent.click(a);
    fireEvent.click(b);
    expect(a).toHaveAttribute('aria-expanded', 'true');
    expect(b).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(a);
    expect(a).toHaveAttribute('aria-expanded', 'false');
  });

  it('respeta defaultOpen', () => {
    render(
      <Accordion type="multiple" defaultOpen={['b']}>
        <AccordionItem id="a" title="A">
          CA
        </AccordionItem>
        <AccordionItem id="b" title="B">
          CB
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('AccordionItem fuera de un Accordion lanza un error claro', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <AccordionItem id="x" title="X">
          c
        </AccordionItem>,
      ),
    ).toThrow(/dentro de <Accordion>/);
    spy.mockRestore();
  });

  it('no tiene violaciones axe', async () => {
    const { container } = render(<Sample />);
    fireEvent.click(screen.getByRole('button', { name: 'Sección A' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
