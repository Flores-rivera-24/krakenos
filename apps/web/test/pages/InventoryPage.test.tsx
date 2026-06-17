import type { Device } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Socket falso para el store de inventario.
const fakeSocket = vi.hoisted(() => ({
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));
vi.mock('@/lib/api', () => ({ api: { patch: vi.fn(), post: vi.fn(), del: vi.fn() }, ApiRequestError: class extends Error {} }));

import { InventoryPage } from '@/pages/InventoryPage';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    mac: 'aa:bb:cc:dd:ee:01',
    ip: '192.168.1.10',
    hostname: 'macbook',
    label: null,
    notes: null,
    vendor: 'Apple',
    type: 'computer',
    isBlocked: false,
    online: true,
    sources: ['arp'],
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('InventoryPage', () => {
  beforeEach(() => {
    fakeSocket.emit.mockClear();
    useInventoryStore.setState({ devices: {}, connected: true, recentEvents: [] });
    useAuthStore.setState({
      user: { id: 'u', email: 'a@b.c', displayName: 'A', role: 'viewer', createdAt: '', updatedAt: '' },
      tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
    });
  });

  it('muestra el estado vacío sin dispositivos', () => {
    render(<InventoryPage />);
    expect(screen.getByText(/Sin dispositivos todavía/)).toBeInTheDocument();
  });

  it('lista los dispositivos del store', () => {
    useInventoryStore.setState({
      devices: { d1: device({ id: 'd1', hostname: 'macbook' }), d2: device({ id: 'd2', label: 'Router', ip: '192.168.1.1' }) },
    });
    render(<InventoryPage />);
    expect(screen.getByText('macbook')).toBeInTheDocument();
    expect(screen.getByText('Router')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
  });

  it('el botón Re-escanear emite por el socket', async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);
    await user.click(screen.getByRole('button', { name: 'Re-escanear' }));
    expect(fakeSocket.emit).toHaveBeenCalledWith('inventory:rescan');
  });

  it('al hacer clic en una fila abre el modal de detalle', async () => {
    useInventoryStore.setState({ devices: { d1: device({ id: 'd1', hostname: 'macbook' }) } });
    const user = userEvent.setup();
    render(<InventoryPage />);

    await user.click(screen.getByText('macbook'));
    // El modal contiene el botón de guardar, que la tabla no tiene.
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
  });
});
