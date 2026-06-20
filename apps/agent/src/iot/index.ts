import type { IotKind, IotManager } from '@krakenos/types';
import { GoveeIotManager } from './govee.iot.js';
import { DgramUdpTransport } from './govee.transport.js';
import { HueIotManager } from './hue.iot.js';
import { HueClient } from './hue.transport.js';
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

/** Config para la integración Philips Hue real (`kind: 'hue'`, CLIP API v2). */
export interface HueIotConfig {
  /** URL base del bridge, p. ej. `https://192.168.1.50`. */
  url: string;
  /** Application key (header `hue-application-key`). */
  appKey: string;
}

/** Config para la integración Govee real (`kind: 'govee'`, API LAN). */
export interface GoveeIotConfig {
  /** Puerto de recepción UDP (por defecto 4002). */
  listenPort?: number;
}

export interface IotConfig {
  kind: IotKind;
  /** Requerido cuando `kind === 'zigbee'`. */
  zigbee?: ZigbeeIotConfig;
  /** Requerido cuando `kind === 'matter'`. */
  matter?: MatterIotConfig;
  /** Requerido cuando `kind === 'hue'`. */
  hue?: HueIotConfig;
  /** Opcional cuando `kind === 'govee'`. */
  govee?: GoveeIotConfig;
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
      // La conexión MQTT la arranca `startIotManager` (lifecycle en server.ts).
      return new ZigbeeIotManager({
        transport: new MqttClientTransport({ url: zb.url, username: zb.username, password: zb.password }),
        baseTopic: zb.baseTopic,
      });
    }
    case 'matter': {
      const mt = config.matter;
      if (!mt) throw new Error('Falta la configuración Matter (IotConfig.matter)');
      return new MatterIotManager({ transport: new WebSocketTransport({ url: mt.url }) });
    }
    case 'hue': {
      const hue = config.hue;
      if (!hue) throw new Error('Falta la configuración Hue (IotConfig.hue)');
      if (!hue.url) throw new Error('La integración Hue requiere HUE_BRIDGE_URL');
      if (!hue.appKey) throw new Error('La integración Hue requiere HUE_APP_KEY');
      return new HueIotManager({ client: new HueClient({ baseUrl: hue.url, appKey: hue.appKey }) });
    }
    case 'govee':
      // El discovery LAN lo arranca `startIotManager` (lifecycle en server.ts).
      return new GoveeIotManager({
        transport: new DgramUdpTransport({ listenPort: config.govee?.listenPort }),
      });
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Integración IoT desconocida: ${String(exhaustive)}`);
    }
  }
}

/**
 * Arranca el manager si expone `start()` (zigbee/govee mantienen una conexión
 * en segundo plano). Captura el fallo para no tumbar el proceso ni dejar un
 * unhandled rejection; el manager queda funcional (lista vacía hasta conectar).
 */
export function startIotManager(manager: IotManager, onError: (message: string) => void): void {
  const startable = manager as { start?: () => Promise<void> };
  if (typeof startable.start === 'function') {
    startable.start().catch((err: unknown) => onError((err as Error).message));
  }
}

export { MockIotManager, IotError } from './mock.iot.js';
export { ZigbeeIotManager } from './zigbee.iot.js';
export { MatterIotManager } from './matter.iot.js';
export { HueIotManager } from './hue.iot.js';
export { GoveeIotManager } from './govee.iot.js';
