import type { IsoDateTime } from './common.js';

/**
 * Estado del TLS de la instalación (US-241).
 *
 * Sin HTTPS **no hay contexto seguro** en el navegador, y eso no es una molestia
 * estética: se caen el service worker (PWA), Web Push y WebAuthn — o sea, la app
 * instalable, los avisos y las passkeys. Tres features entregadas que quedan
 * inertes, y hasta ahora nada en la app lo decía.
 */

/** De dónde sale el certificado que se está sirviendo. */
export type TlsSource =
  /** Certificado de Let's Encrypt emitido por Tailscale para `*.ts.net`. */
  | 'tailscale'
  /** Autofirmado: el navegador avisará salvo que se instale la CA en cada dispositivo. */
  | 'self-signed'
  /** Hay cert pero no se puede clasificar su origen. */
  | 'unknown';

export interface TlsStatus {
  /** ¿Está el agente sirviendo HTTPS él mismo? */
  enabled: boolean;
  /**
   * `true` si el agente va detrás de un proxy de confianza que termina TLS. En ese
   * caso `enabled` puede ser `false` y aun así haber contexto seguro.
   */
  behindProxy: boolean;
  source: TlsSource | null;
  /** Fin de validez del certificado servido. */
  notAfter: IsoDateTime | null;
  /** Días que le quedan (negativo si ya caducó). */
  daysLeft: number | null;
  /** ¿Entra en la ventana de aviso? */
  expiring: boolean;
  /** ¿Ya caducó? El navegador ya está rechazando la conexión. */
  expired: boolean;
  /**
   * Qué funciones están desactivadas ahora mismo por falta de contexto seguro.
   * Vacío si hay HTTPS. Se calcula en el servidor para que la UI no tenga que
   * mantener su propia lista y se le olvide una.
   */
  disabledFeatures: TlsDisabledFeature[];
}

/** Funciones que exigen contexto seguro (US-234, US-45, US-50/51). */
export type TlsDisabledFeature = 'pwa' | 'push' | 'passkeys';
