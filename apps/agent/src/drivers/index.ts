import type { DriverKind, HardwareDriver } from '@krakenos/types';
import { MockDriver } from './mock.driver.js';
import { OpenWrtDriver } from './openwrt.driver.js';
import { SshTransport } from './openwrt.transport.js';

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

export interface CreateDriverConfig {
  kind: DriverKind;
  /** Host/IP del dispositivo (display + SSH). */
  host?: string;
  /** Requerido cuando `kind === 'openwrt'`. */
  openwrt?: OpenWrtDriverConfig;
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
    case 'pfsense':
      throw new Error('Driver pfSense aún no implementado');
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Driver desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockDriver } from './mock.driver.js';
export { OpenWrtDriver } from './openwrt.driver.js';
export { SshTransport } from './openwrt.transport.js';
