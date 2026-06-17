import type { IotKind, IotManager } from '@krakenos/types';
import { MockIotManager } from './mock.iot.js';

export interface IotConfig {
  kind: IotKind;
}

/**
 * Construye la integración IoT según la configuración. El resto del agente
 * solo conoce la interfaz `IotManager`. `mock` está implementado; `zigbee`/
 * `matter` son las integraciones reales pendientes.
 */
export function createIotManager(config: IotConfig): IotManager {
  switch (config.kind) {
    case 'mock':
      return new MockIotManager();
    case 'zigbee':
      throw new Error('Integración Zigbee aún no implementada');
    case 'matter':
      throw new Error('Integración Matter aún no implementada');
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Integración IoT desconocida: ${String(exhaustive)}`);
    }
  }
}

export { MockIotManager, IotError } from './mock.iot.js';
