import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToggleChip, ToggleChipGroup } from '@/components/ui/toggle-chip';

describe('ToggleChip', () => {
  it('alterna aria-pressed y avisa con el valor siguiente', async () => {
    const onPressedChange = vi.fn();
    const { rerender } = render(
      <ToggleChip pressed={false} onPressedChange={onPressedChange}>
        Online
      </ToggleChip>,
    );
    const boton = screen.getByRole('button', { name: 'Online' });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(boton);
    expect(onPressedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <ToggleChip pressed onPressedChange={onPressedChange}>
        Online
      </ToggleChip>,
    );
    expect(screen.getByRole('button', { name: 'Online' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Online' }));
    expect(onPressedChange).toHaveBeenLastCalledWith(false);
    expect(onPressedChange).toHaveBeenCalledTimes(2);
  });

  it('pill y day miden 44 px en móvil', () => {
    render(
      <>
        <ToggleChip pressed={false} onPressedChange={() => {}}>
          Pill
        </ToggleChip>
        <ToggleChip pressed={false} onPressedChange={() => {}} shape="day">
          D
        </ToggleChip>
      </>,
    );
    const pill = screen.getByRole('button', { name: 'Pill' });
    const day = screen.getByRole('button', { name: 'D' });
    expect(pill).toHaveClass('min-h-11', 'rounded-full', 'md:h-8');
    expect(day).toHaveClass('min-h-11', 'h-11', 'w-11', 'rounded-md', 'md:h-9', 'md:w-9');
  });

  it('pulsado y suelto usan tokens distintos', () => {
    render(
      <>
        <ToggleChip pressed onPressedChange={() => {}}>
          A
        </ToggleChip>
        <ToggleChip pressed={false} onPressedChange={() => {}}>
          B
        </ToggleChip>
      </>,
    );
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass(
      'border-kr-accent',
      'bg-kr-accent-faint',
    );
    expect(screen.getByRole('button', { name: 'B' })).toHaveClass('border-kr', 'bg-kr-elevated');
  });

  it('no envía formularios', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ToggleChip pressed={false} onPressedChange={() => {}}>
          X
        </ToggleChip>
      </form>,
    );
    const boton = screen.getByRole('button', { name: 'X' });
    expect(boton).toHaveAttribute('type', 'button');
    await userEvent.click(boton);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ToggleChipGroup', () => {
  it('es un grupo con nombre, no un radiogroup', () => {
    render(
      <ToggleChipGroup aria-label="Filtros">
        <ToggleChip pressed={false} onPressedChange={() => {}}>
          A
        </ToggleChip>
      </ToggleChipGroup>,
    );
    expect(screen.getByRole('group', { name: 'Filtros' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});
