import type { DriverKind, HardwareDriver } from '@krakenos/types';
import { CiscoIosDriver } from './cisco-ios.driver.js';
import { SshCiscoTransport } from './cisco-ios.transport.js';
import { CiscoNetconfDriver } from './cisco-netconf.driver.js';
import { SshNetconfTransport } from './cisco-netconf.transport.js';
import { MockDriver } from './mock.driver.js';
import { OpenWrtDriver } from './openwrt.driver.js';
import { SshTransport } from './openwrt.transport.js';
import { PfSenseDriver } from './pfsense.driver.js';
import { PfSenseClient } from './pfsense.transport.js';
import { MikrotikDriver } from './mikrotik.driver.js';
import { RestMikrotikTransport, SshMikrotikTransport } from './mikrotik.transport.js';
import { OmadaDriver } from './omada.driver.js';
import { OmadaClient } from './omada.transport.js';
import { UnifiDriver } from './unifi.driver.js';
import { UnifiClient } from './unifi.transport.js';

/** Config SSH+UCI para el driver OpenWrt real (`kind: 'openwrt'`). */
export interface OpenWrtDriverConfig {
  /** Interfaz WAN para el muestreo de tráfico, p. ej. `wan` o `eth1`. */
  wanInterface: string;
  /** Red UCI de invitados (por defecto `guest`). */
  guestNetwork?: string;
  ssh: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
  };
}

/** Config para el driver pfSense real (`kind: 'pfsense'`, REST API v2). */
export interface PfSenseDriverConfig {
  /** URL base, p. ej. `https://192.168.1.1`. */
  baseUrl: string;
  /** API key del paquete REST API de pfSense. */
  apiKey: string;
  /** Interfaz WAN para el muestreo de tráfico (por defecto `wan`). */
  wanInterface?: string;
  /** Interfaz donde se crean las reglas de bloqueo (por defecto `lan`). */
  lanInterface?: string;
}

/** Config SSH+CLI para el driver Cisco IOS real (`kind: 'cisco-ios'`). */
export interface CiscoIosDriverConfig {
  /** Interfaz WAN para el muestreo de tráfico, p. ej. `GigabitEthernet0/0`. */
  interface: string;
  /** VLAN por defecto para las entradas de bloqueo (por defecto `1`). */
  vlan?: string;
  ssh: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    /** Contraseña de `enable` (modo privilegiado), si aplica. */
    enablePassword?: string;
  };
}

/** Config NETCONF para el driver Cisco IOS-XE real (`kind: 'cisco-netconf'`). */
export interface CiscoNetconfDriverConfig {
  /** Interfaz WAN para el muestreo de tráfico, p. ej. `GigabitEthernet1`. */
  interface: string;
  netconf: {
    host: string;
    port?: number;
    username: string;
    password?: string;
  };
}

/** Modo de transporte del driver MikroTik. */
export type MikrotikMode = 'rest' | 'ssh';

/** Config para el driver MikroTik real (`kind: 'mikrotik'`, REST o SSH). */
export interface MikrotikDriverConfig {
  /** `rest` (RouterOS 7, por defecto) o `ssh` (fallback CLI). */
  mode: MikrotikMode;
  host: string;
  username: string;
  password: string;
  /** Interfaz WAN para el muestreo de tráfico (por defecto `ether1`). */
  wanInterface?: string;
  /** Modo REST: usar HTTPS (por defecto `true`). */
  https?: boolean;
  /** Modo SSH: puerto (por defecto 22). */
  sshPort?: number;
}

/** Config para el driver UniFi Network real (`kind: 'unifi'`, API local). */
export interface UnifiDriverConfig {
  /** URL base del controller, p. ej. `https://192.168.1.1`. */
  url: string;
  username: string;
  password: string;
  /** Site de UniFi (por defecto `default`). */
  site?: string;
}

/** Config para el driver TP-Link Omada real (`kind: 'omada'`, API local). */
export interface OmadaDriverConfig {
  /** URL base del controller, p. ej. `https://192.168.1.10:8043`. */
  url: string;
  username: string;
  password: string;
  /** Nombre del site (por defecto `Default`). */
  siteName?: string;
  /** `omadacId` del controller; vacío → autodetección vía `/api/info`. */
  omadacId?: string;
}

export interface CreateDriverConfig {
  kind: DriverKind;
  /** Host/IP del dispositivo (display + SSH). */
  host?: string;
  /** Requerido cuando `kind === 'openwrt'`. */
  openwrt?: OpenWrtDriverConfig;
  /** Requerido cuando `kind === 'pfsense'`. */
  pfsense?: PfSenseDriverConfig;
  /** Requerido cuando `kind === 'cisco-ios'`. */
  ciscoIos?: CiscoIosDriverConfig;
  /** Requerido cuando `kind === 'cisco-netconf'`. */
  ciscoNetconf?: CiscoNetconfDriverConfig;
  /** Requerido cuando `kind === 'unifi'`. */
  unifi?: UnifiDriverConfig;
  /** Requerido cuando `kind === 'mikrotik'`. */
  mikrotik?: MikrotikDriverConfig;
  /** Requerido cuando `kind === 'omada'`. */
  omada?: OmadaDriverConfig;
}

/**
 * Construye el driver de hardware adecuado según la configuración. El resto del
 * agente sólo conoce la interfaz `HardwareDriver`. `mock` simula en memoria;
 * `openwrt` opera un router real vía SSH+UCI. `pfsense` queda pendiente.
 */
export function createDriver(config: CreateDriverConfig): HardwareDriver {
  switch (config.kind) {
    case 'mock':
      return new MockDriver();
    case 'openwrt': {
      const ow = config.openwrt;
      if (!ow) throw new Error('Falta la configuración OpenWrt (CreateDriverConfig.openwrt)');
      if (!ow.ssh.host) throw new Error('El driver OpenWrt requiere DRIVER_HOST (host SSH del router)');
      return new OpenWrtDriver({
        transport: new SshTransport(ow.ssh),
        wanInterface: ow.wanInterface,
        guestNetwork: ow.guestNetwork,
        host: config.host ?? ow.ssh.host,
      });
    }
    case 'pfsense': {
      const pf = config.pfsense;
      if (!pf) throw new Error('Falta la configuración pfSense (CreateDriverConfig.pfsense)');
      if (!pf.baseUrl) throw new Error('El driver pfSense requiere DRIVER_HOST (URL/host del router)');
      if (!pf.apiKey) throw new Error('El driver pfSense requiere PFSENSE_API_KEY');
      return new PfSenseDriver({
        client: new PfSenseClient({ baseUrl: pf.baseUrl, apiKey: pf.apiKey }),
        wanInterface: pf.wanInterface,
        lanInterface: pf.lanInterface,
      });
    }
    case 'cisco-ios': {
      const ci = config.ciscoIos;
      if (!ci) throw new Error('Falta la configuración Cisco IOS (CreateDriverConfig.ciscoIos)');
      if (!ci.ssh.host) throw new Error('El driver Cisco IOS requiere DRIVER_HOST (host SSH del switch)');
      return new CiscoIosDriver({
        transport: new SshCiscoTransport(ci.ssh),
        interface: ci.interface,
        vlan: ci.vlan,
        host: config.host ?? ci.ssh.host,
      });
    }
    case 'cisco-netconf': {
      const cn = config.ciscoNetconf;
      if (!cn) throw new Error('Falta la configuración Cisco NETCONF (CreateDriverConfig.ciscoNetconf)');
      if (!cn.netconf.host) throw new Error('El driver Cisco NETCONF requiere CISCO_NETCONF_HOST');
      return new CiscoNetconfDriver({
        transport: new SshNetconfTransport(cn.netconf),
        interface: cn.interface,
        host: config.host ?? cn.netconf.host,
      });
    }
    case 'unifi': {
      const un = config.unifi;
      if (!un) throw new Error('Falta la configuración UniFi (CreateDriverConfig.unifi)');
      if (!un.url) throw new Error('El driver UniFi requiere UNIFI_URL (URL del controller)');
      if (!un.username || !un.password) {
        throw new Error('El driver UniFi requiere UNIFI_USERNAME y UNIFI_PASSWORD');
      }
      return new UnifiDriver({
        client: new UnifiClient({
          url: un.url,
          username: un.username,
          password: un.password,
        }),
        site: un.site,
        host: config.host ?? un.url,
      });
    }
    case 'mikrotik': {
      const mt = config.mikrotik;
      if (!mt) throw new Error('Falta la configuración MikroTik (CreateDriverConfig.mikrotik)');
      if (!mt.host) throw new Error('El driver MikroTik requiere MIKROTIK_HOST');
      if (!mt.username || !mt.password) {
        throw new Error('El driver MikroTik requiere MIKROTIK_USER y MIKROTIK_PASSWORD');
      }
      const transport =
        mt.mode === 'ssh'
          ? new SshMikrotikTransport({
              host: mt.host,
              port: mt.sshPort,
              username: mt.username,
              password: mt.password,
            })
          : new RestMikrotikTransport({
              baseUrl: `${mt.https === false ? 'http' : 'https'}://${mt.host}`,
              username: mt.username,
              password: mt.password,
            });
      return new MikrotikDriver({
        transport,
        wanInterface: mt.wanInterface,
        host: config.host ?? mt.host,
      });
    }
    case 'omada': {
      const om = config.omada;
      if (!om) throw new Error('Falta la configuración Omada (CreateDriverConfig.omada)');
      if (!om.url) throw new Error('El driver Omada requiere OMADA_URL (URL del controller)');
      if (!om.username || !om.password) {
        throw new Error('El driver Omada requiere OMADA_USERNAME y OMADA_PASSWORD');
      }
      return new OmadaDriver({
        client: new OmadaClient({ url: om.url, username: om.username, password: om.password }),
        siteName: om.siteName,
        omadacId: om.omadacId,
        host: config.host ?? om.url,
      });
    }
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Driver desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockDriver } from './mock.driver.js';
export { OpenWrtDriver } from './openwrt.driver.js';
export { SshTransport } from './openwrt.transport.js';
export { PfSenseDriver } from './pfsense.driver.js';
export { PfSenseClient } from './pfsense.transport.js';
export { CiscoIosDriver } from './cisco-ios.driver.js';
export { SshCiscoTransport, MockCiscoTransport } from './cisco-ios.transport.js';
export { CiscoNetconfDriver } from './cisco-netconf.driver.js';
export { SshNetconfTransport, MockNetconfTransport } from './cisco-netconf.transport.js';
export { UnifiDriver } from './unifi.driver.js';
export { UnifiClient } from './unifi.transport.js';
export { MikrotikDriver, FeatureNotSupportedError } from './mikrotik.driver.js';
export { RestMikrotikTransport, SshMikrotikTransport } from './mikrotik.transport.js';
export { OmadaDriver } from './omada.driver.js';
export { OmadaClient } from './omada.transport.js';
