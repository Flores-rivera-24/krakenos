import type { DiscoveredDevice } from './inventory.js';
import type { PerDeviceTrafficCapability, TrafficSampleResult } from './traffic.js';
import type {
  AccessPoint,
  GuestNetwork,
  UpdateGuestNetworkRequest,
  UpdateWifiNetworkRequest,
  UpdateWifiRequest,
  WifiClient,
  WifiNetwork,
  WifiNetworkInfo,
} from './wifi.js';

/**
 * Implementaciones de driver de hardware disponibles.
 *
 * US-238 retiró `cisco-ios` y `cisco-netconf`: ~1.600 LOC de equipo de empresa,
 * cero usuarios domésticos y cero verificaciones con hardware real. Un hogar con
 * un Catalyst es un caso que este proyecto no puede sostener ni comprobar.
 */
export type DriverKind =
  | 'mock'
  | 'openwrt'
  | 'pfsense'
  | 'unifi'
  | 'mikrotik'
  | 'omada'
  | 'asus';

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

  /**
   * Libera la conexión persistente del transporte (SSH/SNMP/sesión HTTP) si la
   * hay. Lo invoca `disposeManager` al recargar la integración en caliente y al
   * cerrar el agente, además de la prueba de conexión del asistente —que crea un
   * manager transitorio y lo tira—. Un driver sin conexión persistente lo omite.
   *
   * Antes de US-229 esto no existía: `disposeManager` buscaba `stop`/`close`/
   * `dispose` **en el manager**, los drivers no lo tenían y su `dispose()` vivía
   * en el transporte, así que cada «Probar conexión» dejaba una sesión SSH
   * abierta contra el router del usuario (AUD3-16).
   */
  stop?(): Promise<void>;

  /** Verifica conectividad/credenciales contra el dispositivo. */
  healthcheck(): Promise<boolean>;

  /** Barrido ARP de la red local. */
  scanArp(): Promise<DiscoveredDevice[]>;

  /** Descubrimiento mDNS (aporta hostnames y, a veces, dispositivos extra). */
  scanMdns(): Promise<DiscoveredDevice[]>;

  /**
   * Muestra puntual de ancho de banda: WAN (rx/tx en bytes/seg) y, si el driver
   * lo soporta, desglose por dispositivo. Los que no lo soportan devuelven
   * `devices: []`.
   */
  getTrafficSample(): Promise<TrafficSampleResult>;

  /**
   * Estado **real** de la capacidad de desglose por dispositivo (US-251).
   *
   * Opcional a propósito: para casi todos los drivers la respuesta es estática y
   * la da el mapa declarado de `drivers/capabilities.ts`. Solo la implementan los
   * que dependen de algo del router —OpenWrt necesita `nlbwmon` instalado—, donde
   * la respuesta correcta **no se puede saber sin preguntarle al aparato**.
   *
   * Debe ser barata de llamar (cachear el sondeo dentro del driver): la invocan
   * las rutas de tráfico y de bienestar en cada carga de página.
   */
  perDeviceTrafficCapability?(): Promise<PerDeviceTrafficCapability>;

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

  // ---- Multi-AP (Fase 2) ----

  /** Lista los access points gestionados. */
  listAccessPoints(): Promise<AccessPoint[]>;

  /** Lista todas las redes (SSID) a través de los access points. */
  listWifiNetworks(): Promise<WifiNetworkInfo[]>;

  /** Devuelve una red por id, o `null` si no existe. */
  getWifiNetwork(id: string): Promise<WifiNetworkInfo | null>;

  /** Aplica cambios a una red concreta; `null` si no existe. */
  updateWifiNetwork(id: string, input: UpdateWifiNetworkRequest): Promise<WifiNetworkInfo | null>;

  /** Clientes conectados a una red; `null` si la red no existe. */
  listNetworkClients(id: string): Promise<WifiClient[] | null>;
}
