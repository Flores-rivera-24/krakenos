import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { IotError } from './mock.iot.js';
import type { MqttTransport } from './mqtt.transport.js';
import {
  type ZigbeeDeviceMeta,
  brightnessToZigbee,
  buildSetPayload,
  parseBridgeDevices,
  parseDeviceState,
} from './zigbee2mqtt.parsers.js';

export interface ZigbeeIotOptions {
  transport: MqttTransport;
  /** Topic base de zigbee2mqtt (por defecto `zigbee2mqtt`). */
  baseTopic?: string;
}

/**
 * Integración IoT real sobre **zigbee2mqtt** vía MQTT. Se suscribe al registro
 * de dispositivos del bridge y a sus estados, manteniendo una caché en memoria
 * (zigbee2mqtt es la fuente de verdad); el control se hace publicando en
 * `<base>/<id>/set`. La lógica de mapeo es pura (`zigbee2mqtt.parsers`); aquí se
 * orquestan la suscripción, la caché y la publicación.
 */
export class ZigbeeIotManager implements IotManager {
  readonly kind = 'zigbee' as const;
  private readonly base: string;
  private readonly meta = new Map<string, ZigbeeDeviceMeta>();
  private readonly raw = new Map<string, Record<string, unknown>>();
  private readonly availability = new Map<string, boolean>();
  private started = false;

  constructor(private readonly opts: ZigbeeIotOptions) {
    this.base = opts.baseTopic ?? 'zigbee2mqtt';
  }

  /** Suscribe a los topics de zigbee2mqtt (idempotente). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const onMessage = this.onMessage.bind(this);
    await this.opts.transport.subscribe(`${this.base}/bridge/devices`, onMessage);
    await this.opts.transport.subscribe(`${this.base}/+/availability`, onMessage);
    await this.opts.transport.subscribe(`${this.base}/+`, onMessage);
  }

  /** Enruta un mensaje MQTT entrante a la caché correspondiente según el topic. */
  private onMessage(topic: string, payload: string): void {
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      json = payload; // availability puede llegar como texto plano "online"/"offline"
    }
    if (topic === `${this.base}/bridge/devices`) {
      this.meta.clear();
      for (const m of parseBridgeDevices(json)) this.meta.set(m.id, m);
      return;
    }
    if (topic.endsWith('/availability')) {
      const id = topic.slice(this.base.length + 1, -'/availability'.length);
      const online =
        json && typeof json === 'object'
          ? (json as { state?: string }).state === 'online'
          : json === 'online';
      this.availability.set(id, online);
      return;
    }
    // Estado de un dispositivo: `<base>/<id>`.
    if (topic.startsWith(`${this.base}/`)) {
      const id = topic.slice(this.base.length + 1);
      if (id.includes('/') || id === 'bridge') return; // no es un estado de dispositivo
      this.raw.set(id, (json && typeof json === 'object' ? json : {}) as Record<string, unknown>);
    }
  }

  private toDevice(id: string): IotDevice {
    const meta = this.meta.get(id);
    const kind = meta?.kind ?? 'sensor';
    const state = parseDeviceState(this.raw.get(id));
    const reachable = this.availability.get(id) ?? this.raw.has(id);
    return {
      id,
      name: meta?.name ?? id,
      kind,
      room: null,
      reachable,
      on: kind === 'sensor' ? null : state.on,
      brightness: kind === 'light' ? state.brightness : null,
      reading: kind === 'sensor' ? state.reading : null,
    };
  }

  async listDevices(): Promise<IotDevice[]> {
    return [...this.meta.keys()].map((id) => this.toDevice(id));
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    return this.meta.has(id) ? this.toDevice(id) : null;
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const meta = this.meta.get(id);
    if (!meta) throw new IotError('IOT_NOT_FOUND', 'Dispositivo no encontrado');
    if (meta.kind === 'sensor') {
      throw new IotError('IOT_NOT_CONTROLLABLE', 'Un sensor no se puede controlar');
    }

    await this.opts.transport.publish(`${this.base}/${id}/set`, buildSetPayload(input, meta.kind));

    // Actualización optimista de la caché (zigbee2mqtt confirmará por su topic).
    const current = { ...(this.raw.get(id) ?? {}) };
    if (input.on !== undefined) current.state = input.on ? 'ON' : 'OFF';
    if (input.brightness !== undefined && meta.kind === 'light') {
      current.brightness = brightnessToZigbee(input.brightness);
      if (input.on === undefined) current.state = input.brightness > 0 ? 'ON' : 'OFF';
    }
    this.raw.set(id, current);
    return this.toDevice(id);
  }
}
