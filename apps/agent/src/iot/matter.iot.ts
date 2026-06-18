import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import {
  buildLevelArgs,
  buildOnOffArgs,
  endpointForCluster,
  nodeToIotDevice,
  parseNodes,
  percentToLevel,
} from './matter.parsers.js';
import { MatterClient, type WsTransport } from './matter.transport.js';
import { IotError } from './mock.iot.js';

const ONOFF_CLUSTER = 6;
const LEVEL_CLUSTER = 8;

export interface MatterIotOptions {
  transport: WsTransport;
}

/**
 * Integración IoT real sobre **Matter** vía la API WebSocket de
 * python-matter-server. Lee los nodos (`get_nodes`) y los mapea a `IotDevice`;
 * el control envía `device_command` a los clusters OnOff/LevelControl. La lógica
 * de mapeo/comandos es pura (`matter.parsers`); aquí se orquesta el cliente.
 *
 * Baseline: lectura por petición (sin caché por suscripción) y actualización
 * optimista del estado devuelto tras el comando.
 */
export class MatterIotManager implements IotManager {
  readonly kind = 'matter' as const;
  private readonly client: MatterClient;

  constructor(opts: MatterIotOptions) {
    this.client = new MatterClient(opts.transport);
  }

  private async nodes() {
    return parseNodes(await this.client.request('get_nodes', {}));
  }

  async listDevices(): Promise<IotDevice[]> {
    return (await this.nodes()).map(nodeToIotDevice);
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    const node = (await this.nodes()).find((n) => String(n.node_id) === id);
    return node ? nodeToIotDevice(node) : null;
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const node = (await this.nodes()).find((n) => String(n.node_id) === id);
    if (!node) throw new IotError('IOT_NOT_FOUND', 'Dispositivo no encontrado');
    const device = nodeToIotDevice(node);
    if (device.kind === 'sensor') {
      throw new IotError('IOT_NOT_CONTROLLABLE', 'Un sensor no se puede controlar');
    }

    if (input.on !== undefined) {
      const ep = endpointForCluster(node, ONOFF_CLUSTER);
      await this.client.request('device_command', buildOnOffArgs(node.node_id, ep, input.on));
    }
    if (input.brightness !== undefined && device.kind === 'light') {
      const ep = endpointForCluster(node, LEVEL_CLUSTER);
      await this.client.request(
        'device_command',
        buildLevelArgs(node.node_id, ep, percentToLevel(input.brightness)),
      );
    }

    // Estado optimista (matter-server confirmará por sus eventos de atributo).
    const next: IotDevice = { ...device };
    if (input.on !== undefined) next.on = input.on;
    if (input.brightness !== undefined && device.kind === 'light') {
      next.brightness = input.brightness;
      if (input.on === undefined) next.on = input.brightness > 0;
    }
    return next;
  }
}
