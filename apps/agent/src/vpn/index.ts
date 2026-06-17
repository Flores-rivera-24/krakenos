import type { VpnKind, VpnManager } from '@krakenos/types';
import { MockVpnManager } from './mock.vpn.js';

export interface VpnConfig {
  kind: VpnKind;
  endpoint: string;
  listenPort: number;
}

/**
 * Construye el gestor de VPN según la configuración. El resto del agente solo
 * conoce la interfaz `VpnManager`. `mock` está implementado; `wireguard`
 * (helper privilegiado vía sudoers) es la pieza de producción pendiente.
 */
export function createVpnManager(config: VpnConfig): VpnManager {
  switch (config.kind) {
    case 'mock':
      return new MockVpnManager({ endpoint: config.endpoint, listenPort: config.listenPort });
    case 'wireguard':
      throw new Error('Gestor WireGuard real aún no implementado (helper vía sudoers)');
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de VPN desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockVpnManager } from './mock.vpn.js';
