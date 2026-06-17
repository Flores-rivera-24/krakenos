import type { Device } from '@krakenos/types';
import { create } from 'zustand';
import { getSocket } from '@/lib/socket';

interface InventoryState {
  devices: Record<string, Device>;
  connected: boolean;
  /** Suscribe a los eventos de Socket.io. Devuelve la función de limpieza. */
  subscribe: () => () => void;
  rescan: () => void;
}

export const useInventoryStore = create<InventoryState>((set) => ({
  devices: {},
  connected: false,

  subscribe: () => {
    const socket = getSocket();

    const onConnect = () => set({ connected: true });
    const onDisconnect = () => set({ connected: false });
    const onSnapshot = (devices: Device[]) =>
      set({ devices: Object.fromEntries(devices.map((d) => [d.id, d])) });
    const onUpdated = (device: Device) =>
      set((state) => ({ devices: { ...state.devices, [device.id]: device } }));
    const onRemoved = (deviceId: string) =>
      set((state) => {
        const next = { ...state.devices };
        delete next[deviceId];
        return { devices: next };
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
