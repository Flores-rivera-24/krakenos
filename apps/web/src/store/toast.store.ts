import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: string) => void;
}

/**
 * Cola de toasts global (US-96): feedback transitorio del **resultado de una
 * acción** de escritura (éxito/fallo), independiente del `ErrorBanner` de carga
 * (US-93). El `Toaster` (montado una vez en `AppLayout`) la rinde y auto-descarta.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) =>
    set((state) => ({ toasts: [...state.toasts, { id: crypto.randomUUID(), kind, message }] })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Helper imperativo: `toast.success('…')` / `toast.error('…')` desde cualquier handler. */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
};
