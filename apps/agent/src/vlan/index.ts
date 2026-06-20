import type { VlanKind, VlanManager } from '@krakenos/types';
import { SshCiscoTransport } from '../drivers/cisco-ios.transport.js';
import { FileJsonStore } from '../store/json-store.js';
import { CiscoVlanManager } from './cisco.vlan.js';
import { MockVlanManager } from './mock.vlan.js';
import { NetSnmpTransport } from './snmp.transport.js';
import { SwitchVlanManager } from './switch.vlan.js';

/** Config para el gestor de VLANs real (`kind: 'switch'`, vía SNMP). */
export interface SwitchVlanConfig {
  host: string;
  community?: string;
  port?: number;
  /** Fichero JSON donde se persisten los metadatos de las VLANs. */
  storePath: string;
}

/** Config para el gestor de VLANs Cisco (`kind: 'cisco'`, vía SSH+CLI de IOS). */
export interface CiscoVlanConfig {
  host: string;
  username: string;
  password?: string;
  port?: number;
  enablePassword?: string;
  /** Fichero JSON donde se persisten los metadatos de las VLANs. */
  storePath: string;
}

export interface VlanConfig {
  kind: VlanKind;
  /** Requerido cuando `kind === 'switch'`. */
  switch?: SwitchVlanConfig;
  /** Requerido cuando `kind === 'cisco'`. */
  cisco?: CiscoVlanConfig;
}

/**
 * Construye el gestor de VLANs según la configuración. El resto del agente solo
 * conoce la interfaz `VlanManager`. `mock` mantiene las definiciones en memoria;
 * `switch` aplica las VLANs 802.1Q a un switch gestionado vía SNMP, con los
 * metadatos persistidos en un fichero.
 */
export function createVlanManager(config: VlanConfig): VlanManager {
  switch (config.kind) {
    case 'mock':
      return new MockVlanManager();
    case 'switch': {
      const sw = config.switch;
      if (!sw) throw new Error('Falta la configuración del switch (VlanConfig.switch)');
      if (!sw.host) throw new Error('El gestor de VLANs por switch requiere VLAN_SWITCH_HOST');
      return new SwitchVlanManager({
        store: new FileJsonStore(sw.storePath),
        snmp: new NetSnmpTransport({ host: sw.host, community: sw.community, port: sw.port }),
      });
    }
    case 'cisco': {
      const ci = config.cisco;
      if (!ci) throw new Error('Falta la configuración Cisco de VLANs (VlanConfig.cisco)');
      if (!ci.host) throw new Error('El gestor de VLANs Cisco requiere DRIVER_HOST');
      return new CiscoVlanManager({
        store: new FileJsonStore(ci.storePath),
        transport: new SshCiscoTransport({
          host: ci.host,
          port: ci.port,
          username: ci.username,
          password: ci.password,
          enablePassword: ci.enablePassword,
        }),
      });
    }
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de VLANs desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockVlanManager, VlanError } from './mock.vlan.js';
export { SwitchVlanManager } from './switch.vlan.js';
export { CiscoVlanManager } from './cisco.vlan.js';
