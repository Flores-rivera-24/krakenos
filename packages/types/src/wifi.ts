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

// ---- Multi-AP (Fase 2) ----

/** Punto de acceso WiFi gestionado. */
export interface AccessPoint {
  id: string;
  name: string;
  model: string | null;
  ip: string;
  online: boolean;
  /** Nº de redes (SSID) que emite. */
  networkCount: number;
}

/** Red (SSID) emitida por un access point concreto. */
export interface WifiNetworkInfo {
  id: string;
  /** Access point que la emite. */
  apId: string;
  ssid: string;
  band: WifiBand;
  security: WifiSecurity;
  enabled: boolean;
  hidden: boolean;
  isGuest: boolean;
  /** Nº de clientes conectados. */
  clientCount: number;
}

/** Cliente conectado a una red WiFi. */
export interface WifiClient {
  mac: string;
  hostname: string | null;
  ip: string;
  /** Intensidad de señal en dBm (negativo; más cercano a 0 es mejor). */
  signalDbm: number;
}

/** Cambios aplicables a una red concreta (la contraseña nunca se devuelve). */
export interface UpdateWifiNetworkRequest {
  ssid?: string;
  password?: string;
  enabled?: boolean;
  band?: WifiBand;
  security?: WifiSecurity;
  hidden?: boolean;
}
