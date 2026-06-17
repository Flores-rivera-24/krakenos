import type { Device } from '@krakenos/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Socket falso controlable: registra handlers y permite dispararlos a mano.
const { fakeSocket, handlers } = vi.hoisted(() => {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const fakeSocket = {
    connected: false,
    on(event: string, cb: (...args: unknown[]) => void) {
      (handlers[event] ??= []).push(cb);
    },
    off(event: string, cb: (...args: unknown[]) => void) {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== cb);
    },
    emit: vi.fn(),
  };
  return { fakeSocket, handlers };
});

vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { useInventoryStore } from '@/store/inventory.store';

function trigger(event: string, ...args: unknown[]): void {
  for (const h of handlers[event] ?? []) h(...args);
}

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    mac: 'aa:bb:cc:dd:ee:01',
    ip: '192.168.1.10',
    hostname: 'host',
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

describe('useInventoryStore', () => {
  beforeEach(() => {
    useInventoryStore.setState({ devices: {}, connected: false, recentEvents: [] });
    for (const k of Object.keys(handlers)) delete handlers[k];
    fakeSocket.connected = false;
    fakeSocket.emit.mockClear();
  });

  it('subscribe registra los handlers y devuelve limpieza', () => {
    const cleanup = useInventoryStore.getState().subscribe();
    expect(handlers['inventory:snapshot']).toHaveLength(1);
    expect(handlers['inventory:device-updated']).toHaveLength(1);
    cleanup();
    expect(handlers['inventory:snapshot']).toHaveLength(0);
  });

  it('marca connected si el socket ya estaba conectado al suscribir', () => {
    fakeSocket.connected = true;
    useInventoryStore.getState().subscribe();
    expect(useInventoryStore.getState().connected).toBe(true);
  });

  it('snapshot hidrata el estado sin generar actividad', () => {
    useInventoryStore.getState().subscribe();
    trigger('inventory:snapshot', [device({ id: 'd1' }), device({ id: 'd2' })]);
    expect(Object.keys(useInventoryStore.getState().devices)).toEqual(['d1', 'd2']);
    expect(useInventoryStore.getState().recentEvents).toHaveLength(0);
  });

  it('device-updated agrega/actualiza el dispositivo y registra actividad', () => {
    useInventoryStore.getState().subscribe();
    trigger('inventory:device-updated', device({ id: 'd1', label: 'Router' }));
    const state = useInventoryStore.getState();
    expect(state.devices.d1?.label).toBe('Router');
    expect(state.recentEvents[0]).toMatchObject({ kind: 'updated', label: 'Router' });
  });

  it('device-removed elimina el dispositivo y registra actividad', () => {
    useInventoryStore.getState().subscribe();
    trigger('inventory:snapshot', [device({ id: 'd1', label: 'Tele' })]);
    trigger('inventory:device-removed', 'd1');
    const state = useInventoryStore.getState();
    expect(state.devices.d1).toBeUndefined();
    expect(state.recentEvents[0]).toMatchObject({ kind: 'removed', label: 'Tele' });
  });

  it('connect / disconnect actualizan el flag', () => {
    useInventoryStore.getState().subscribe();
    trigger('connect');
    expect(useInventoryStore.getState().connected).toBe(true);
    trigger('disconnect');
    expect(useInventoryStore.getState().connected).toBe(false);
  });

  it('recentEvents se limita a 25 entradas', () => {
    useInventoryStore.getState().subscribe();
    for (let i = 0; i < 30; i++) {
      trigger('inventory:device-updated', device({ id: `d${i}` }));
    }
    expect(useInventoryStore.getState().recentEvents).toHaveLength(25);
  });

  it('rescan emite el evento por el socket', () => {
    useInventoryStore.getState().rescan();
    expect(fakeSocket.emit).toHaveBeenCalledWith('inventory:rescan');
  });
});
