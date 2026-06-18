import type { IotKind, IotManager } from '@krakenos/types';
import { MockIotManager } from './mock.iot.js';
import { MqttClientTransport } from './mqtt.transport.js';
import { ZigbeeIotManager } from './zigbee.iot.js';

/** Config para la integración Zigbee real (`kind: 'zigbee'`, vía zigbee2mqtt). */
export interface ZigbeeIotConfig {
  /** URL del broker MQTT, p. ej. `mqtt://localhost:1883`. */
  url: string;
  /** Topic base de zigbee2mqtt (por defecto `zigbee2mqtt`). */
  baseTopic?: string;
  username?: string;
  password?: string;
}

export interface IotConfig {
  kind: IotKind;
  /** Requerido cuando `kind === 'zigbee'`. */
  zigbee?: ZigbeeIotConfig;
}

/**
 * Construye la integración IoT según la configuración. El resto del agente
 * solo conoce la interfaz `IotManager`. `mock` simula en memoria; `zigbee`
 * habla con zigbee2mqtt vía MQTT. `matter` queda pendiente.
 */
export function createIotManager(config: IotConfig): IotManager {
  switch (config.kind) {
    case 'mock':
      return new MockIotManager();
    case 'zigbee': {
      const zb = config.zigbee;
      if (!zb) throw new Error('Falta la configuración Zigbee (IotConfig.zigbee)');
      const manager = new ZigbeeIotManager({
        transport: new MqttClientTransport({ url: zb.url, username: zb.username, password: zb.password }),
        baseTopic: zb.baseTopic,
      });
      // Suscripción en segundo plano; los errores de conexión se reflejan en `reachable`.
      void manager.start();
      return manager;
    }
    case 'matter':
      throw new Error('Integración Matter aún no implementada');
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Integración IoT desconocida: ${String(exhaustive)}`);
    }
  }
}

export { MockIotManager, IotError } from './mock.iot.js';
export { ZigbeeIotManager } from './zigbee.iot.js';
