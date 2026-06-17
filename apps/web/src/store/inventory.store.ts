import type { Device } from '@krakenos/types';
import { create } from 'zustand';
import { getSocket } from '@/lib/socket';

/** Entrada del feed de actividad reciente del dashboard. */
export interface ActivityEvent {
  id: string;
  kind: 'updated' | 'removed';
  label: string;
  at: string;
}

const MAX_EVENTS = 25;

function deviceLabel(d: Device): string {
  return d.label ?? d.hostname ?? d.mac;
}

interface InventoryState {
  devices: Record<string, Device>;
  connected: boolean;
  recentEvents: ActivityEvent[];
  /** Suscribe a los eventos de Socket.io. Devuelve la función de limpieza. */
  subscribe: () => () => void;
  rescan: () => void;
}

export const useInventoryStore = create<InventoryState>((set) => ({
  devices: {},
  connected: false,
  recentEvents: [],

  subscribe: () => {
    const socket = getSocket();

    const pushEvent = (state: InventoryState, event: ActivityEvent) => ({
      recentEvents: [event, ...state.recentEvents].slice(0, MAX_EVENTS),
    });

    const onConnect = () => set({ connected: true });
    const onDisconnect = () => set({ connected: false });
    // El snapshot inicial no genera actividad (solo hidrata el estado).
    const onSnapshot = (devices: Device[]) =>
      set({ devices: Object.fromEntries(devices.map((d) => [d.id, d])) });
    const onUpdated = (device: Device) =>
      set((state) => ({
        devices: { ...state.devices, [device.id]: device },
        ...pushEvent(state, {
          id: crypto.randomUUID(),
          kind: 'updated',
          label: deviceLabel(device),
          at: new Date().toISOString(),
        }),
      }));
    const onRemoved = (deviceId: string) =>
      set((state) => {
        const prev = state.devices[deviceId];
        const next = { ...state.devices };
        delete next[deviceId];
        return {
          devices: next,
          ...pushEvent(state, {
            id: crypto.randomUUID(),
            kind: 'removed',
            label: prev ? deviceLabel(prev) : deviceId,
            at: new Date().toISOString(),
          }),
        };
      });

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('inventory:snapshot', onSnapshot);
    socket.on('inventory:device-updated', onUpdated);
    socket.on('inventory:device-removed', onRemoved);
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('inventory:snapshot', onSnapshot);
      socket.off('inventory:device-updated', onUpdated);
      socket.off('inventory:device-removed', onRemoved);
    };
  },

  rescan: () => {
    getSocket().emit('inventory:rescan');
  },
}));
