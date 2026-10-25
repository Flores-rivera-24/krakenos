import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Device } from '@krakenos/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Socket falso que guarda los listeners para poder emitir eventos del agente a mano.
const fakeSocket = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  return {
    handlers,
    connected: true,
    active: true,
    on: vi.fn((ev: string, fn: (...a: unknown[]) => void) => {
      handlers.set(ev, [...(handlers.get(ev) ?? []), fn]);
    }),
    off: vi.fn((ev: string, fn: (...a: unknown[]) => void) => {
      handlers.set(
        ev,
        (handlers.get(ev) ?? []).filter((h) => h !== fn),
      );
    }),
    emit: vi.fn(),
    io: { on: vi.fn(), off: vi.fn() },
  };
});
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { AppLayout } from '@/components/layout/AppLayout';
import { DeviceCountWidget } from '@/components/dashboard/widgets/DeviceCountWidget';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';

function device(id: string, over: Partial<Device> = {}): Device {
  return {
    id,
    mac: `aa:bb:cc:dd:ee:${id}`,
    ip: '192.168.1.10',
    hostname: `host-${id}`,
    label: null,
    notes: null,
    vendor: null,
    type: 'computer',
    isBlocked: false,
    online: true,
    vlanTag: null,
    sources: ['arp'],
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    icon: null,
    roomId: null,
    ownerId: null,
    ...over,
  };
}

function emitir(ev: string, ...args: unknown[]) {
  for (const h of fakeSocket.handlers.get(ev) ?? []) h(...args);
}

describe('AppLayout hidrata el inventario', () => {
  beforeEach(() => {
    fakeSocket.handlers.clear();
    useInventoryStore.setState({ devices: {}, connected: false, recentEvents: [] });
    useAuthStore.setState({
      user: {
        id: 'u',
        email: 'a@b.c',
        displayName: 'Emilio',
        role: 'admin',
        createdAt: '',
        updatedAt: '',
      },
      tokens: { accessToken: 't', expiresIn: 900 },
    });
  });

  it('un snapshot emitido antes de que monte la página ya está en el store y la página lo pinta', () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );
    // El agente emite el snapshot UNA vez al conectar; ninguna página ha montado aún.
    act(() =>
      emitir('inventory:snapshot', [device('01'), device('02'), device('03', { online: false })]),
    );
    expect(Object.keys(useInventoryStore.getState().devices)).toHaveLength(3);

    // La página monta después (el Outlet se retrasa hasta que los estados están listos).
    render(
      <MemoryRouter>
        <DeviceCountWidget />
      </MemoryRouter>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('una reconexión vuelve a hidratar y desmontar retira los listeners', () => {
    const { unmount } = render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );
    act(() => emitir('inventory:snapshot', [device('01')]));
    act(() => emitir('inventory:snapshot', [device('01'), device('02')]));
    expect(Object.keys(useInventoryStore.getState().devices)).toHaveLength(2);
    unmount();
    expect(fakeSocket.handlers.get('inventory:snapshot') ?? []).toHaveLength(0);
  });
});
