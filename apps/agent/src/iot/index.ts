import type { IotKind, IotManager } from '@krakenos/types';
import { MatterIotManager } from './matter.iot.js';
import { WebSocketTransport } from './matter.transport.js';
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

/** Config para la integración Matter real (`kind: 'matter'`, vía matter-server). */
export interface MatterIotConfig {
  /** URL WebSocket de python-matter-server, p. ej. `ws://localhost:5580/ws`. */
  url: string;
}

export interface IotConfig {
  kind: IotKind;
  /** Requerido cuando `kind === 'zigbee'`. */
  zigbee?: ZigbeeIotConfig;
  /** Requerido cuando `kind === 'matter'`. */
  matter?: MatterIotConfig;
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
      // Suscripción en segundo plano; un fallo de conexión no debe tumbar el
      // proceso (queda como lista vacía / dispositivos no reachable), así que se
      // captura el rechazo en lugar de dejarlo como unhandled rejection.
      manager.start().catch((err: unknown) => {
        console.error('[iot:zigbee] no se pudo conectar a MQTT:', (err as Error).message);
      });
      return manager;
    }
    case 'matter': {
      const mt = config.matter;
      if (!mt) throw new Error('Falta la configuración Matter (IotConfig.matter)');
      return new MatterIotManager({ transport: new WebSocketTransport({ url: mt.url }) });
    }
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Integración IoT desconocida: ${String(exhaustive)}`);
    }
  }
}

export { MockIotManager, IotError } from './mock.iot.js';
export { ZigbeeIotManager } from './zigbee.iot.js';
export { MatterIotManager } from './matter.iot.js';
