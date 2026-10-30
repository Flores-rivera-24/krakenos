import { createRef, type ChangeEvent } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from '@/components/ui/select';

describe('Select', () => {
  it('tiene la altura y el borde de Input', () => {
    render(
      <Select aria-label="X">
        <option>a</option>
      </Select>,
    );
    const el = screen.getByRole('combobox', { name: 'X' });
    for (const c of ['h-10', 'min-h-11', 'md:min-h-0', 'border-kr-field', 'rounded-md']) {
      expect(el).toHaveClass(c);
    }
  });

  it('el className del llamador gana sobre el ancho', () => {
    render(
      <Select aria-label="X" className="w-auto">
        <option>a</option>
      </Select>,
    );
    const el = screen.getByRole('combobox');
    expect(el).toHaveClass('w-auto');
    expect(el).not.toHaveClass('w-full');
  });

  it('reenvía ref, id, value y onChange', async () => {
    const ref = createRef<HTMLSelectElement>();
    const valores: string[] = [];
    const onChange = vi.fn((e: ChangeEvent<HTMLSelectElement>) => valores.push(e.target.value));
    render(
      <Select aria-label="X" id="sec" ref={ref} value="b" onChange={onChange}>
        <option value="a">a</option>
        <option value="b">b</option>
      </Select>,
    );
    const el = screen.getByRole('combobox');
    expect(ref.current).toBe(el);
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
    expect(el).toHaveAttribute('id', 'sec');
    expect(el).toHaveValue('b');
    await userEvent.setup().selectOptions(el, 'a');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(valores).toEqual(['a']);
  });

  it('deshabilitado se anuncia y se ve', () => {
    render(
      <Select aria-label="X" disabled>
        <option>a</option>
      </Select>,
    );
    const el = screen.getByRole('combobox');
    expect(el).toBeDisabled();
    expect(el).toHaveClass('disabled:opacity-50');
  });
});
