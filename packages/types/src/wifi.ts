import type { IsoDateTime } from './common.js';

/** Banda de radio. */
export type WifiBand = '2.4GHz' | '5GHz' | '6GHz';

/** Modo de seguridad de la red. */
export type WifiSecurity = 'open' | 'wpa2' | 'wpa3' | 'wpa2/wpa3';

/** Red WiFi principal gestionada por el agente. */
export interface WifiNetwork {
  ssid: string;
  enabled: boolean;
  band: WifiBand;
  security: WifiSecurity;
  /** Oculta el SSID en el beacon. */
  hidden: boolean;
  updatedAt: IsoDateTime;
}

/** Red de invitados, aislada de la LAN principal. */
export interface GuestNetwork {
  ssid: string;
  enabled: boolean;
  /** Aísla a los clientes entre sí y de la LAN. */
  clientIsolation: boolean;
  /** Límite de ancho de banda en Mbps; `null` = sin límite. */
  bandwidthLimitMbps: number | null;
  updatedAt: IsoDateTime;
}

/** Cambios aplicables a la red principal (la contraseña nunca se devuelve). */
export interface UpdateWifiRequest {
  ssid?: string;
  password?: string;
  enabled?: boolean;
  band?: WifiBand;
  security?: WifiSecurity;
  hidden?: boolean;
}

export interface UpdateGuestNetworkRequest {
  ssid?: string;
  password?: string;
  enabled?: boolean;
  clientIsolation?: boolean;
  bandwidthLimitMbps?: number | null;
}
