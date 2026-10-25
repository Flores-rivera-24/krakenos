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

describe('Switch · el estado apagado se distingue de su fondo', () => {
  it('apagado usa el token de carril (3:1 medido por check-contrast), no bg-secondary', () => {
    render(<Switch checked={false} onCheckedChange={() => {}} aria-label="Apagado" />);
    const sw = screen.getByRole('switch', { name: 'Apagado' });
    expect(sw.className).toContain('bg-kr-switch-off');
    expect(sw.className).not.toContain('bg-secondary');
  });

  it('el anillo de foco sale del token kr-ring', () => {
    render(<Switch checked onCheckedChange={() => {}} aria-label="Encendido" />);
    expect(screen.getByRole('switch', { name: 'Encendido' }).className).toContain(
      'focus-visible:ring-kr-ring',
    );
  });
});
