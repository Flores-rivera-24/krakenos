import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from '@/components/ui/segmented-control';

const OPCIONES = [
  { value: 'a', label: 'Uno' },
  { value: 'b', label: 'Dos' },
  { value: 'c', label: 'Tres' },
] as const;

describe('SegmentedControl', () => {
  it('es un grupo con nombre y un botón por opción', () => {
    render(
      <SegmentedControl options={OPCIONES} value="a" onChange={() => {}} aria-label="Rango" />,
    );
    const grupo = screen.getByRole('group', { name: 'Rango' });
    expect(grupo).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('marca solo la opción activa', () => {
    render(
      <SegmentedControl options={OPCIONES} value="b" onChange={() => {}} aria-label="Rango" />,
    );
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Dos', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uno', pressed: false })).toBeInTheDocument();
  });

  it('al pulsar otra llama a onChange con su valor', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl options={OPCIONES} value="a" onChange={onChange} aria-label="Rango" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tres' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('pulsar la activa no cambia nada', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl options={OPCIONES} value="a" onChange={onChange} aria-label="Rango" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Uno' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Uno', pressed: true })).toBeInTheDocument();
  });

  it('mide 44 px en móvil y 32 en escritorio', () => {
    render(
      <SegmentedControl options={OPCIONES} value="a" onChange={() => {}} aria-label="Rango" />,
    );
    for (const b of screen.getAllByRole('button')) {
      expect(b).toHaveClass('min-h-11', 'min-w-11', 'md:h-8', 'md:min-h-0');
    }
  });

  it('acepta valores numéricos', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={[
          { value: 1, label: '1 h' },
          { value: 24, label: '24 h' },
        ]}
        value={1}
        onChange={onChange}
        aria-label="Horas"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '24 h' }));
    expect(onChange).toHaveBeenCalledWith(24);
  });
});
