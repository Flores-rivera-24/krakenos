/**
 * Instalación de KrakenOS como app (PWA).
 *
 * Toda la lógica de decisión es **pura** y recibe `window` inyectable: el
 * navegador solo se toca en `iniciarCapturaDeInstalacion`, que engancha los dos
 * eventos que importan (`beforeinstallprompt` y `appinstalled`).
 *
 * ⚠️ `beforeinstallprompt` puede llegar **muy pronto** (antes de que React pinte
 * nada), por eso la captura se arranca en `main.tsx` antes del render y el evento
 * se guarda en un store: la tarjeta de Ajustes, que se monta mucho después, lo
 * encuentra ya esperando. Y solo Chromium lo emite: Safari de iOS/iPadOS no tiene
 * instalación programática, así que ahí solo cabe dar la instrucción manual.
 */

/** El evento no está en `lib.dom`: es una API de Chromium. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

/** Lo mínimo de `window` que usa este módulo (inyectable en los tests). */
export interface VentanaInstalable {
  isSecureContext?: boolean;
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: {
    userAgent?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
  };
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
}

export type EstadoDeInstalacion =
  | 'running'
  | 'installed'
  | 'installable'
  | 'ios'
  | 'insecure'
  | 'unsupported';

/** ¿Ya corre como app (ventana propia) y no en una pestaña? */
export function correComoApp(win: VentanaInstalable | undefined = ventanaActual()): boolean {
  if (!win) return false;
  if (win.navigator?.standalone === true) return true; // iOS: añadida a la pantalla de inicio
  return win.matchMedia?.('(display-mode: standalone)').matches === true;
}

/**
 * ¿iPhone o iPad? iPadOS 13+ se identifica como «Macintosh», así que se
 * distingue por tener pantalla táctil (un Mac no la tiene).
 */
export function esIos(win: VentanaInstalable | undefined = ventanaActual()): boolean {
  const nav = win?.navigator;
  if (!nav) return false;
  const ua = nav.userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/** ¿Contexto seguro (HTTPS o localhost)? Sin él no hay service worker ni instalación. */
export function esContextoSeguro(win: VentanaInstalable | undefined = ventanaActual()): boolean {
  return win?.isSecureContext === true;
}

export interface EntradaDeEstado {
  /** `appinstalled` ya se emitió en esta sesión. */
  instalada: boolean;
  /** Hay un `beforeinstallprompt` guardado. */
  hayEvento: boolean;
  win?: VentanaInstalable;
}

/**
 * Qué enseñar. El orden importa: «ya está» gana a todo, un evento guardado
 * prueba que se puede (y que hay contexto seguro), iOS no tiene evento pero sí
 * vía manual, y solo entonces se distingue «falta HTTPS» de «este navegador no».
 */
export function estadoDeInstalacion({
  instalada,
  hayEvento,
  win,
}: EntradaDeEstado): EstadoDeInstalacion {
  if (correComoApp(win)) return 'running';
  if (instalada) return 'installed';
  if (hayEvento) return 'installable';
  if (esIos(win)) return 'ios';
  if (!esContextoSeguro(win)) return 'insecure';
  return 'unsupported';
}

export interface CapturaDeInstalacion {
  onEvento: (evento: BeforeInstallPromptEvent) => void;
  onInstalada: () => void;
}

/**
 * Engancha `beforeinstallprompt` (con `preventDefault()`: sin él Chromium
 * enseña su propia mini-barra y el evento no se puede diferir) y `appinstalled`.
 * Devuelve la función que los desengancha.
 */
export function iniciarCapturaDeInstalacion(
  captura: CapturaDeInstalacion,
  win: VentanaInstalable | undefined = ventanaActual(),
): () => void {
  if (!win) return () => undefined;
  const alEvento = (e: Event) => {
    e.preventDefault();
    captura.onEvento(e as BeforeInstallPromptEvent);
  };
  const alInstalar = () => captura.onInstalada();
  win.addEventListener('beforeinstallprompt', alEvento);
  win.addEventListener('appinstalled', alInstalar);
  return () => {
    win.removeEventListener('beforeinstallprompt', alEvento);
    win.removeEventListener('appinstalled', alInstalar);
  };
}

function ventanaActual(): VentanaInstalable | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as VentanaInstalable);
}
