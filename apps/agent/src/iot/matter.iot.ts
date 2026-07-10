import type {
  IotDevice,
  IotManager,
  MatterCommissionErrorCode,
  MatterCommissionResult,
  UpdateIotStateRequest,
} from '@krakenos/types';
import {
  buildCommissionArgs,
  buildLevelArgs,
  buildOnOffArgs,
  classifyCommissionError,
  endpointForCluster,
  nodeToIotDevice,
  parseCommissionResult,
  parseNodes,
  percentToLevel,
} from './matter.parsers.js';
import { MatterClient, type WsTransport } from './matter.transport.js';
import { IotError } from './mock.iot.js';

/** Error de comisionado Matter con un código estable para la UI (US-172). */
export class MatterCommissionError extends Error {
  constructor(
    readonly code: MatterCommissionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

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
  private readonly transport: WsTransport;

  constructor(opts: MatterIotOptions) {
    this.transport = opts.transport;
    this.client = new MatterClient(opts.transport);
  }

  /** Cierra el WebSocket al recargar la integración en caliente (US-201). */
  async stop(): Promise<void> {
    await this.transport.dispose?.();
  }

  /**
   * Comisiona un dispositivo Matter nuevo a partir de su QR/código (US-172). Usa
   * `commission_with_code` de python-matter-server; un fallo del controlador se
   * clasifica en un `MatterCommissionError` con código estable para la UI.
   */
  async commission(code: string): Promise<MatterCommissionResult> {
    let result: unknown;
    try {
      result = await this.client.request('commission_with_code', buildCommissionArgs(code));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new MatterCommissionError(classifyCommissionError(message), message);
    }
    const parsed = parseCommissionResult(result);
    if (!parsed) {
      throw new MatterCommissionError('failed', 'El controlador no devolvió un nodo válido');
    }
    // Nombre amable desde el nodo recién añadido (si ya aparece en la lista).
    const node = (await this.nodes()).find((n) => n.node_id === parsed.nodeId);
    const name = node ? nodeToIotDevice(node).name : `Matter ${parsed.nodeId}`;
    return { deviceId: String(parsed.nodeId), name };
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
