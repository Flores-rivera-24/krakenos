import type { VlanKind, VlanManager } from '@krakenos/types';
import { MockVlanManager } from './mock.vlan.js';

export interface VlanConfig {
  kind: VlanKind;
}

/**
 * Construye el gestor de VLANs según la configuración. El resto del agente solo
 * conoce la interfaz `VlanManager`. `mock` está implementado; `switch`
 * (configuración del switch/router real) es la pieza de producción pendiente.
 */
export function createVlanManager(config: VlanConfig): VlanManager {
  switch (config.kind) {
    case 'mock':
      return new MockVlanManager();
    case 'switch':
      throw new Error('Gestor de VLANs real (switch gestionado) aún no implementado');
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de VLANs desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockVlanManager, VlanError } from './mock.vlan.js';
