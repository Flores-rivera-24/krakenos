import type { DriverKind, HardwareDriver } from '@krakenos/types';
import { MockDriver } from './mock.driver.js';
import { OpenWrtDriver } from './openwrt.driver.js';
import { SshTransport } from './openwrt.transport.js';
import { PfSenseDriver } from './pfsense.driver.js';
import { PfSenseClient } from './pfsense.transport.js';
import { MikrotikDriver } from './mikrotik.driver.js';
import { RestMikrotikTransport, SshMikrotikTransport } from './mikrotik.transport.js';
import { AsusDriver } from './asus.driver.js';
import { AsusClient } from './asus.transport.js';
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

/** Config para el driver ASUS/Merlin real (`kind: 'asus'`, appGet.cgi). */
export interface AsusDriverConfig {
  host: string;
  username: string;
  password: string;
  /** Usar HTTPS (por defecto `false`). */
  https?: boolean;
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
  /** Requerido cuando `kind === 'unifi'`. */
  unifi?: UnifiDriverConfig;
  /** Requerido cuando `kind === 'mikrotik'`. */
  mikrotik?: MikrotikDriverConfig;
  /** Requerido cuando `kind === 'omada'`. */
  omada?: OmadaDriverConfig;
  /** Requerido cuando `kind === 'asus'`. */
  asus?: AsusDriverConfig;
}

/**
 * Kinds retirados (US-238). Existen **solo** para dar un error que se entienda:
 * quien tenía `DRIVER_KIND=cisco-ios` en su `.env` se encuentra el agente sin
 * arrancar al actualizar, y «Driver desconocido» no le dice qué hacer.
 *
 * NO se degradan a `mock` a propósito: mock enseña una casa inventada, así que el
 * usuario vería dispositivos que no existen y creería que su red está gestionada.
 * Parar en seco y explicar por qué es lo honesto.
 *
 * ⚠️ El fallback a `.env` de `integrations/runtime.ts::tryBuild` **no cubre este
 * caso**: solo protege de una config guardada en la DB que falle, y aquí el valor
 * retirado está justo en el `.env` que hace de red de seguridad.
 */
const KINDS_RETIRADOS = new Set(['cisco-ios', 'cisco-netconf']);

/**
 * Mensaje de un kind retirado, o `null` si no lo es.
 *
 * ⚠️ **Sin identificadores internos en el texto.** Decía «se retiró en US-238», y
 * quien se encuentra ese error no tiene forma de resolver ese código: no hay
 * tracker público. El motivo sí es accionable; el número de historia no.
 */
function mensajeDeRetirada(kind: string, soportados: string): string | null {
  if (!KINDS_RETIRADOS.has(kind)) return null;
  return (
    `El driver «${kind}» se retiró: era equipo de empresa, sin usuarios domésticos y sin una ` +
    `sola verificación con hardware real. Cambia DRIVER_KIND en tu .env por uno soportado ` +
    `(${soportados}). No se cae a «mock» automáticamente a propósito: te enseñaría una casa ` +
    `inventada como si fuera la tuya.`
  );
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
    case 'asus': {
      const as = config.asus;
      if (!as) throw new Error('Falta la configuración ASUS (CreateDriverConfig.asus)');
      if (!as.host) throw new Error('El driver ASUS requiere ASUS_HOST');
      if (!as.username || !as.password) {
        throw new Error('El driver ASUS requiere ASUS_USERNAME y ASUS_PASSWORD');
      }
      return new AsusDriver({
        client: new AsusClient({
          baseUrl: `${as.https ? 'https' : 'http'}://${as.host}`,
          username: as.username,
          password: as.password,
        }),
        host: config.host ?? as.host,
      });
    }
    default: {
      const kind = String(config.kind as string);
      const retirado = mensajeDeRetirada(kind, 'mock, openwrt, pfsense, unifi, mikrotik, omada, asus');
      if (retirado) throw new Error(retirado);
      throw new Error(`Driver desconocido: ${kind}`);
    }
  }
}

export { MockDriver } from './mock.driver.js';
export { OpenWrtDriver } from './openwrt.driver.js';
export { SshTransport } from './openwrt.transport.js';
export { PfSenseDriver } from './pfsense.driver.js';
export { PfSenseClient } from './pfsense.transport.js';
export { UnifiDriver } from './unifi.driver.js';
export { UnifiClient } from './unifi.transport.js';
export { MikrotikDriver, FeatureNotSupportedError } from './mikrotik.driver.js';
export { RestMikrotikTransport, SshMikrotikTransport } from './mikrotik.transport.js';
export { OmadaDriver } from './omada.driver.js';
export { OmadaClient } from './omada.transport.js';
export { AsusDriver } from './asus.driver.js';
export { AsusClient } from './asus.transport.js';
