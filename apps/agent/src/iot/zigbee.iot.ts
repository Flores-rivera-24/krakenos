import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { isControllableKind, isSwitchableKind } from '@krakenos/types';
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

  /** Cierra la conexión MQTT al recargar la integración en caliente (US-201). */
  async stop(): Promise<void> {
    this.started = false;
    await this.opts.transport.dispose?.();
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
      // US-244: solo `light` y `plug` tienen encendido. Un `contact`, un `smoke` o
      // un `sensor` no se encienden, y una persiana/cerradura tampoco —su estado
      // vive en `position`/`locked`—: dejarles `on` pintaría un interruptor que no
      // hace nada. La lista vive en el contrato desde US-265, no aquí.
      on: isSwitchableKind(kind) ? state.on : null,
      brightness: kind === 'light' ? state.brightness : null,
      // El color de zigbee2mqtt no se mapea aún (baseline); las luces Hue van por IOT_KIND=hue.
      color: null,
      // Las lecturas se pasan tal cual: son del aparato, no de su categoría. Un
      // enchufe con medidor reporta potencia y un sensor de clima temperatura, y
      // filtrarlas por `kind` era lo que tiraba la batería de un sensor de contacto.
      readings: state.readings,
      position: kind === 'cover' ? state.position : null,
      targetC: kind === 'climate' ? state.targetC : null,
      locked: kind === 'lock' ? state.locked : null,
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
    // El guard es el CONTRATO, no una lista propia (US-246). Con `kind === 'sensor'`
    // —lo que había— este backend aceptaba una orden sobre una **cerradura** y
    // publicaba `{"state":"OFF"}` en su topic: que zigbee2mqtt espere ahí
    // `LOCK`/`UNLOCK` y probablemente lo descarte no es una defensa, es depender
    // del conversor de un tercero para que no se abra una puerta. Un `contact` y
    // un `smoke` entraban por el mismo hueco.
    if (!isControllableKind(meta.kind)) {
      throw new IotError('IOT_NOT_CONTROLLABLE', 'Este dispositivo no se puede controlar');
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
