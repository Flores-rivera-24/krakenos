import { create } from 'zustand';
import { iniciarCapturaDeInstalacion, type BeforeInstallPromptEvent } from '@/lib/install';

export type ResultadoDeInstalar = 'accepted' | 'dismissed' | 'unavailable';

interface InstallState {
  /** El `beforeinstallprompt` diferido; solo sirve para UN `prompt()`. */
  evento: BeforeInstallPromptEvent | null;
  /** `appinstalled` llegó (o el usuario aceptó) en esta sesión. */
  instalada: boolean;
  setEvento: (evento: BeforeInstallPromptEvent | null) => void;
  marcarInstalada: () => void;
  /** Lanza el diálogo del navegador y lee la elección. Nunca lanza. */
  instalar: () => Promise<ResultadoDeInstalar>;
}

/**
 * Estado de la instalación como app. Es de **sesión de página**, no persiste: lo
 * que el navegador sabe (evento, display-mode) se vuelve a leer en cada carga.
 */
export const useInstallStore = create<InstallState>((set, get) => ({
  evento: null,
  instalada: false,
  setEvento: (evento) => set({ evento }),
  marcarInstalada: () => set({ instalada: true, evento: null }),
  instalar: async () => {
    const evento = get().evento;
    if (!evento) return 'unavailable';
    // El evento es de un solo uso: tras `prompt()` ya no vale, se acepte o no.
    set({ evento: null });
    try {
      await evento.prompt();
      const { outcome } = await evento.userChoice;
      if (outcome === 'accepted') {
        set({ instalada: true });
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    }
  },
}));

/** Se llama una vez desde `main.tsx`, antes del primer render. */
export function iniciarCapturaDeInstalacionGlobal(): () => void {
  const { setEvento, marcarInstalada } = useInstallStore.getState();
  return iniciarCapturaDeInstalacion({ onEvento: setEvento, onInstalada: marcarInstalada });
}
