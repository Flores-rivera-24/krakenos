import type { Device } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AlertsCard } from '@/components/dashboard/AlertsCard';

function device(over: Partial<Device> = {}): Device {
  return {
    id: Math.random().toString(36).slice(2),
    mac: 'aa:bb:cc:dd:ee:01',
    ip: '192.168.1.10',
    hostname: null,
    label: null,
    notes: null,
    vendor: null,
    type: 'computer',
    isBlocked: false,
    online: true,
    sources: ['arp'],
    firstSeen: '',
    lastSeen: '',
    ...over,
  };
}

function renderCard(devices: Device[]) {
  return render(
    <MemoryRouter>
      <AlertsCard devices={devices} />
    </MemoryRouter>,
  );
}

describe('AlertsCard', () => {
  it('muestra estado tranquilo sin desconocidos', () => {
    renderCard([device({ type: 'computer' })]);
    expect(screen.getByText('Sin dispositivos desconocidos.')).toBeInTheDocument();
  });

  it('ignora desconocidos offline', () => {
    renderCard([device({ type: 'unknown', online: false })]);
    expect(screen.getByText('Sin dispositivos desconocidos.')).toBeInTheDocument();
  });

  it('cuenta los desconocidos online y enlaza al inventario', () => {
    renderCard([
      device({ id: 'a', type: 'unknown', online: true }),
      device({ id: 'b', type: 'unknown', online: true }),
    ]);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/dispositivos.*desconocidos.*en la red/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver inventario/i })).toHaveAttribute('href', '/inventory');
  });
});
