import type { RoomWithState } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoomSelect } from '@/components/rooms/RoomSelect';

function room(over: Partial<RoomWithState> = {}): RoomWithState {
  return {
    id: 'r1',
    name: 'Salón',
    icon: 'living',
    order: 0,
    createdAt: '',
    deviceCount: 0,
    iotCount: 0,
    controllableCount: 0,
    onCount: 0,
    anyUnreachable: false,
    ...over,
  };
}

describe('RoomSelect (US-165)', () => {
  it('lista «Sin habitación» más cada habitación y refleja el valor actual', () => {
    render(<RoomSelect rooms={[room(), room({ id: 'r2', name: 'Cocina', icon: 'kitchen' })]} value="r2" onChange={() => {}} />);
    const select = screen.getByLabelText('Habitación') as HTMLSelectElement;
    expect(select.value).toBe('r2');
    expect(screen.getByRole('option', { name: /Sin habitación/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Cocina/ })).toBeInTheDocument();
  });

  it('emite el id elegido, o null al elegir «Sin habitación»', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RoomSelect rooms={[room()]} value="r1" onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText('Habitación'), '');
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
