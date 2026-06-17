import type { DiscoveredDevice } from './inventory.js';
import type {
  GuestNetwork,
  UpdateGuestNetworkRequest,
  UpdateWifiRequest,
  WifiNetwork,
} from './wifi.js';

/** Implementaciones de driver de hardware disponibles. */
export type DriverKind = 'mock' | 'openwrt' | 'pfsense';

/** Configuración para instanciar un driver. */
export interface DriverConfig {
  kind: DriverKind;
  /** Host/IP del dispositivo de red (no aplica al mock). */
  host?: string;
  /** Credenciales/token de acceso al dispositivo. */
  credentials?: Record<string, string>;
}

/**
 * Contrato que todo adaptador de hardware debe cumplir.
 *
 * Los drivers son intercambiables (pfSense, OpenWrt, mock). El resto del
 * agente depende únicamente de esta interfaz, nunca de una implementación
 * concreta.
 */
export interface HardwareDriver {
  readonly kind: DriverKind;

  /** Verifica conectividad/credenciales contra el dispositivo. */
  healthcheck(): Promise<boolean>;

  /** Barrido ARP de la red local. */
  scanArp(): Promise<DiscoveredDevice[]>;

  /** Descubrimiento mDNS (aporta hostnames y, a veces, dispositivos extra). */
  scanMdns(): Promise<DiscoveredDevice[]>;

  /** Bloquea el acceso a la red del dispositivo con esa MAC. */
  blockDevice(mac: string): Promise<void>;

  /** Restaura el acceso a la red del dispositivo con esa MAC. */
  unblockDevice(mac: string): Promise<void>;

  /** Estado actual de la red WiFi principal. */
  getWifi(): Promise<WifiNetwork>;

  /** Aplica cambios a la red WiFi principal. */
  updateWifi(input: UpdateWifiRequest): Promise<WifiNetwork>;

  /** Estado actual de la red de invitados. */
  getGuestNetwork(): Promise<GuestNetwork>;

  /** Aplica cambios a la red de invitados. */
  updateGuestNetwork(input: UpdateGuestNetworkRequest): Promise<GuestNetwork>;
}
