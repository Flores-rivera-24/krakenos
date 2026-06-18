import type { FirewallKind, FirewallManager, FirewallRule } from '@krakenos/types';
import { SudoHelperRunner } from '../privileged/runner.js';
import { FileJsonStore } from '../store/json-store.js';
import { IptablesFirewallManager } from './iptables.firewall.js';
import { MockFirewallManager } from './mock.firewall.js';

/** Config específica del gestor iptables real (`kind: 'iptables'`). */
export interface IptablesManagerConfig {
  chain: string;
  helperPath: string;
  useSudo?: boolean;
  /** Fichero JSON donde se persiste el registro de reglas. */
  ruleStorePath: string;
}

export interface FirewallConfig {
  kind: FirewallKind;
  /** Requerido cuando `kind === 'iptables'`. */
  iptables?: IptablesManagerConfig;
}

/**
 * Construye el gestor de firewall según la configuración. El resto del agente
 * solo conoce la interfaz `FirewallManager`. `mock` simula en memoria;
 * `iptables` aplica las reglas a una cadena dedicada delegando los comandos
 * privilegiados al helper vía sudoers.
 */
export function createFirewallManager(config: FirewallConfig): FirewallManager {
  switch (config.kind) {
    case 'mock':
      return new MockFirewallManager();
    case 'iptables': {
      const ipt = config.iptables;
      if (!ipt) throw new Error('Falta la configuración iptables (FirewallConfig.iptables)');
      return new IptablesFirewallManager({
        runner: new SudoHelperRunner({ helperPath: ipt.helperPath, useSudo: ipt.useSudo }),
        store: new FileJsonStore<FirewallRule>(ipt.ruleStorePath),
        chain: ipt.chain,
      });
    }
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de firewall desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockFirewallManager, FirewallError } from './mock.firewall.js';
export { IptablesFirewallManager } from './iptables.firewall.js';
