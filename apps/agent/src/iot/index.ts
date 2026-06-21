import type { IotKind, IotManager } from '@krakenos/types';
import { FileJsonStore } from '../store/json-store.js';
import { CompositeIotManager } from './composite.iot.js';
import { GoveeIotManager } from './govee.iot.js';
import { DgramUdpTransport } from './govee.transport.js';
import { HueIotManager } from './hue.iot.js';
import { HueClient } from './hue.transport.js';
import { MatterIotManager } from './matter.iot.js';
import { WebSocketTransport } from './matter.transport.js';
import { MockIotManager } from './mock.iot.js';
import { MqttClientTransport } from './mqtt.transport.js';
import { TuyaIotManager } from './tuya.iot.js';
import type { TuyaDeviceRecord } from './tuya.store.js';
import { TuyapiTransport } from './tuya.transport.js';
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

/** Config para la integración Tuya real (`kind: 'tuya'`, protocolo local). */
export interface TuyaIotConfig {
  /** Ruta al fichero de config de dispositivos (id/localKey/ip por dispositivo). */
  configPath: string;
}

export interface IotConfig {
  /** `IotKind`, o una lista separada por comas para varios a la vez (`hue,govee`). */
  kind: string;
  /** Requerido cuando `kind === 'zigbee'`. */
  zigbee?: ZigbeeIotConfig;
  /** Requerido cuando `kind === 'matter'`. */
  matter?: MatterIotConfig;
  /** Requerido cuando `kind === 'hue'`. */
  hue?: HueIotConfig;
  /** Opcional cuando `kind === 'govee'`. */
  govee?: GoveeIotConfig;
  /** Requerido cuando `kind === 'tuya'`. */
  tuya?: TuyaIotConfig;
}

/**
 * Resultado de `createIotManager`: el manager IoT y, si la config Tuya está
 * presente, **la misma instancia** de `tuyaStore` que usa el manager `tuya`.
 * Las rutas `/api/iot/tuya` reciben este store para compartir la cola de
 * serialización (US-52) con el manager — antes había dos instancias distintas
 * apuntando al mismo fichero (fuga de la factory, US-63).
 */
export interface IotManagerBundle {
  manager: IotManager;
  tuyaStore?: FileJsonStore<TuyaDeviceRecord>;
}

/**
 * Construye la integración IoT. `kind` puede ser un único valor o una **lista
 * separada por comas** (`hue,govee`): con varios, se envuelven en un
 * `CompositeIotManager` que enruta por prefijo de id. El resto del agente solo
 * conoce la interfaz `IotManager`.
 *
 * El `tuyaStore` (fuente de verdad de la config Tuya) se crea aquí una sola vez
 * y se inyecta tanto en el manager `tuya` como, vía el bundle, en sus rutas de
 * gestión: una única instancia, sin fugas.
 */
export function createIotManager(config: IotConfig): IotManagerBundle {
  const kinds = config.kind
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean) as IotKind[];

  // Store Tuya único: lo comparten el manager `tuya` y las rutas `/api/iot/tuya`.
  const tuyaStore = config.tuya
    ? new FileJsonStore<TuyaDeviceRecord>(config.tuya.configPath)
    : undefined;

  const manager =
    kinds.length <= 1
      ? buildIotManager(kinds[0] ?? 'mock', config, tuyaStore)
      : new CompositeIotManager(
          kinds.map((kind) => ({ prefix: kind, manager: buildIotManager(kind, config, tuyaStore) })),
        );

  return { manager, tuyaStore };
}

/** Construye un único manager para un `kind` concreto. */
function buildIotManager(
  kind: IotKind,
  config: IotConfig,
  tuyaStore?: FileJsonStore<TuyaDeviceRecord>,
): IotManager {
  switch (kind) {
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
    case 'tuya': {
      const tuya = config.tuya;
      if (!tuya) throw new Error('Falta la configuración Tuya (IotConfig.tuya)');
      // El store de config (id/localKey/ip por dispositivo) es la fuente de verdad;
      // lo crea `createIotManager` y lo comparte (misma instancia) con las rutas
      // de gestión `/api/iot/tuya`. El fallback solo aplica si se construye este
      // manager de forma aislada (p. ej. en tests del propio manager).
      return new TuyaIotManager({
        store: tuyaStore ?? new FileJsonStore<TuyaDeviceRecord>(tuya.configPath),
        transport: new TuyapiTransport(),
      });
    }
    default: {
      const exhaustive: never = kind;
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
export { TuyaIotManager } from './tuya.iot.js';
export { CompositeIotManager } from './composite.iot.js';
