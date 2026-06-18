import type { QosKind, QosManager, QosRule } from '@krakenos/types';
import { SudoHelperRunner } from '../privileged/runner.js';
import { FileJsonStore } from '../store/json-store.js';
import { MockQosManager } from './mock.qos.js';
import { TcQosManager } from './tc.qos.js';

/** Config específica del gestor tc real (`kind: 'tc'`). */
export interface TcManagerConfig {
  interface: string;
  linkKbit: number;
  helperPath: string;
  useSudo?: boolean;
  /** Fichero JSON donde se persiste el registro de reglas. */
  ruleStorePath: string;
}

export interface QosConfig {
  kind: QosKind;
  /** Requerido cuando `kind === 'tc'`. */
  tc?: TcManagerConfig;
}

/**
 * Construye el gestor de QoS según la configuración. El resto del agente solo
 * conoce la interfaz `QosManager`. `mock` simula en memoria; `tc` moldea el
 * tráfico (HTB) de una interfaz delegando los comandos privilegiados al helper.
 */
export function createQosManager(config: QosConfig): QosManager {
  switch (config.kind) {
    case 'mock':
      return new MockQosManager();
    case 'tc': {
      const tc = config.tc;
      if (!tc) throw new Error('Falta la configuración tc (QosConfig.tc)');
      return new TcQosManager({
        runner: new SudoHelperRunner({ helperPath: tc.helperPath, useSudo: tc.useSudo }),
        store: new FileJsonStore<QosRule>(tc.ruleStorePath),
        interface: tc.interface,
        linkKbit: tc.linkKbit,
      });
    }
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de QoS desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockQosManager, QosError } from './mock.qos.js';
export { TcQosManager } from './tc.qos.js';
