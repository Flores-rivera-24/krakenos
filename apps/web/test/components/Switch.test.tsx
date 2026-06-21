import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from '@/components/ui/switch';

describe('Switch', () => {
  it('expone role=switch con aria-checked reflejando el estado', () => {
    render(<Switch checked onCheckedChange={() => {}} aria-label="Modo nocturno" />);
    const sw = screen.getByRole('switch', { name: 'Modo nocturno' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('se puede operar por teclado (Space)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onCheckedChange={onChange} aria-label="Activar" />);
    screen.getByRole('switch', { name: 'Activar' }).focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
