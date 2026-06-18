import type { VlanKind, VlanManager } from '@krakenos/types';
import { FileJsonStore } from '../store/json-store.js';
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

export interface VlanConfig {
  kind: VlanKind;
  /** Requerido cuando `kind === 'switch'`. */
  switch?: SwitchVlanConfig;
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
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de VLANs desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockVlanManager, VlanError } from './mock.vlan.js';
export { SwitchVlanManager } from './switch.vlan.js';
