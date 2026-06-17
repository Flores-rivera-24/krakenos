import type { QosKind, QosManager } from '@krakenos/types';
import { MockQosManager } from './mock.qos.js';

export interface QosConfig {
  kind: QosKind;
}

/**
 * Construye el gestor de QoS según la configuración. El resto del agente solo
 * conoce la interfaz `QosManager`. `mock` está implementado; `tc` (control de
 * tráfico del kernel vía helper privilegiado) es la pieza de producción pendiente.
 */
export function createQosManager(config: QosConfig): QosManager {
  switch (config.kind) {
    case 'mock':
      return new MockQosManager();
    case 'tc':
      throw new Error('Gestor de QoS real (tc) aún no implementado (helper vía sudoers)');
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de QoS desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockQosManager, QosError } from './mock.qos.js';
