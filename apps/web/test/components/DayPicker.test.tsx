import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DayPicker } from '@/components/ui/day-picker';
import { changeLocale, setLocale } from '@/lib/i18n';

describe('DayPicker', () => {
  afterEach(() => {
    setLocale('es', { persist: false });
  });

  it('siete botones con el nombre completo del día', () => {
    render(<DayPicker selected={[]} onToggle={() => {}} aria-label="Días" />);
    expect(screen.getByRole('group', { name: 'Días' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(7);
    for (const n of ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']) {
      expect(screen.getByRole('button', { name: n })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Lunes' })).toHaveTextContent('L');
  });

  it('en inglés también', async () => {
    render(<DayPicker selected={[]} onToggle={() => {}} aria-label="Days" />);
    await changeLocale('en', { persist: false });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Monday' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sunday' })).toHaveTextContent('S');
  });

  it('marca los seleccionados', () => {
    render(<DayPicker selected={[0, 2]} onToggle={() => {}} aria-label="Días" />);
    const pulsados = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pulsados.map((b) => b.getAttribute('aria-label'))).toEqual(['Domingo', 'Martes']);
  });

  it('onToggle recibe el índice', async () => {
    const onToggle = vi.fn();
    render(<DayPicker selected={[]} onToggle={onToggle} aria-label="Días" />);
    await userEvent.click(screen.getByRole('button', { name: 'Jueves' }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('disabled deshabilita los siete', () => {
    render(<DayPicker selected={[]} onToggle={() => {}} aria-label="Días" disabled />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('en móvil las siete casillas se reparten en una fila y desde md vuelven a ser cuadradas', () => {
    render(<DayPicker selected={[]} onToggle={() => {}} aria-label="Días" />);
    expect(screen.getByRole('group', { name: 'Días' })).toHaveClass(
      'grid',
      'grid-cols-7',
      'md:flex',
      'md:flex-wrap',
    );
    for (const b of screen.getAllByRole('button')) {
      expect(b).toHaveClass('h-11', 'w-full', 'min-w-0', 'md:h-9', 'md:w-9');
    }
  });
});
