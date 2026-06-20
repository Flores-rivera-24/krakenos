import type { Device } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeviceCard } from '@/components/inventory/DeviceCard';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    mac: 'aa:bb:cc:dd:ee:01',
    ip: '192.168.1.10',
    hostname: 'macbook',
    label: 'MacBook',
    notes: null,
    vendor: 'Apple',
    type: 'computer',
    isBlocked: false,
    online: true,
    vlanTag: null,
    sources: ['arp'],
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('DeviceCard', () => {
  it('renderiza nombre e IP del dispositivo', () => {
    render(<DeviceCard device={device()} onSelect={() => {}} />);
    expect(screen.getByText('MacBook')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.10')).toBeInTheDocument();
  });

  it('muestra "Blocked" con color danger aunque online sea true', () => {
    render(<DeviceCard device={device({ isBlocked: true, online: true })} onSelect={() => {}} />);
    const status = screen.getByText('Blocked');
    expect(status).toBeInTheDocument();
    expect(status).toHaveClass('text-danger');
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
  });

  it('click llama al handler onSelect con el id', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<DeviceCard device={device({ id: 'xyz' })} onSelect={onSelect} />);
    await user.click(screen.getByText('MacBook'));
    expect(onSelect).toHaveBeenCalledWith('xyz');
  });
});
