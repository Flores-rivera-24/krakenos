import type { FirewallKind, FirewallManager } from '@krakenos/types';
import { MockFirewallManager } from './mock.firewall.js';

export interface FirewallConfig {
  kind: FirewallKind;
}

/**
 * Construye el gestor de firewall según la configuración. El resto del agente
 * solo conoce la interfaz `FirewallManager`. `mock` está implementado;
 * `iptables` (helper privilegiado vía sudoers) es la pieza de producción
 * pendiente.
 */
export function createFirewallManager(config: FirewallConfig): FirewallManager {
  switch (config.kind) {
    case 'mock':
      return new MockFirewallManager();
    case 'iptables':
      throw new Error('Gestor iptables real aún no implementado (helper vía sudoers)');
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de firewall desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockFirewallManager, FirewallError } from './mock.firewall.js';
