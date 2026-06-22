import { randomUUID } from 'node:crypto';
import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import {
  type ChannelState,
  type MerossDeviceConfig,
  MEROSS_RESP_FILTER,
  buildSystemAll,
  buildToggleX,
  extractChannelStates,
  merossCmdTopic,
  merossToIotDevice,
  parseMerossId,
  parseMerossMessage,
  uuidFromTopic,
} from './meross.parsers.js';
import { IotError } from './mock.iot.js';
import type { MqttTransport } from './mqtt.transport.js';

export interface MerossIotOptions {
  transport: MqttTransport;
  /** Dispositivos configurados (`MEROSS_DEVICES`); no hay discovery en esta US. */
  devices: MerossDeviceConfig[];
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
  /** Generador de messageId; inyectable para tests deterministas. */
  genMessageId?: () => string;
}

/**
 * Integración IoT para **Meross** sobre un **broker MQTT local** (sin nube). Los
 * dispositivos se configuran a mano (`MEROSS_DEVICES`, con su `key`); cada canal
 * es un `IotDevice` (`meross:<uuid>:<channel>`). El manager se suscribe a las
 * respuestas (`m/v1/+/publish`), mantiene una caché de estado y publica comandos
 * firmados en `m/v1/<uuid>/subscribe`. El protocolo es puro (`meross.parsers`).
 */
export class MerossIotManager implements IotManager {
  readonly kind = 'meross' as const;
  private readonly byUuid = new Map<string, MerossDeviceConfig>();
  private readonly cache = new Map<string, Map<number, ChannelState>>();
  private readonly now: () => number;
  private readonly genMessageId: () => string;
  private started = false;

  constructor(private readonly opts: MerossIotOptions) {
    for (const d of opts.devices) this.byUuid.set(d.uuid, { channels: 1, ...d });
    this.now = opts.now ?? Date.now;
    this.genMessageId = opts.genMessageId ?? (() => randomUUID().replace(/-/g, ''));
  }

  /** Se suscribe a las respuestas y pide el estado inicial (idempotente). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.opts.transport.subscribe(MEROSS_RESP_FILTER, (topic, payload) =>
      this.onMessage(topic, payload),
    );
    await this.refreshAll();
  }

  private onMessage(topic: string, payload: string): void {
    const uuid = uuidFromTopic(topic);
    if (!uuid || !this.byUuid.has(uuid)) return;
    const parsed = parseMerossMessage(payload);
    if (!parsed) return;
    if (!/Appliance\.(System\.All|Control\.ToggleX)/.test(parsed.namespace)) return;
    const states = extractChannelStates(parsed.payload);
    if (states.size === 0) return;
    const current = this.cache.get(uuid) ?? new Map<number, ChannelState>();
    for (const [ch, st] of states) current.set(ch, st);
    this.cache.set(uuid, current);
  }

  private ctx(cfg: MerossDeviceConfig) {
    return { key: cfg.key, messageId: this.genMessageId(), timestamp: Math.floor(this.now() / 1000) };
  }

  /** Publica un GET `Appliance.System.All` a cada dispositivo (best-effort). */
  private async refreshAll(): Promise<void> {
    for (const cfg of this.byUuid.values()) {
      await this.opts.transport
        .publish(merossCmdTopic(cfg.uuid), buildSystemAll(this.ctx(cfg)))
        .catch(() => undefined);
    }
  }

  private devicesFor(cfg: MerossDeviceConfig): IotDevice[] {
    const states = this.cache.get(cfg.uuid);
    const channels = cfg.channels ?? 1;
    const out: IotDevice[] = [];
    for (let ch = 0; ch < channels; ch++) out.push(merossToIotDevice(cfg, ch, states?.get(ch)));
    return out;
  }

  async listDevices(): Promise<IotDevice[]> {
    void this.refreshAll(); // refresco best-effort, no bloquea
    return [...this.byUuid.values()].flatMap((cfg) => this.devicesFor(cfg));
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    const ref = parseMerossId(id);
    const cfg = ref && this.byUuid.get(ref.uuid);
    if (!ref || !cfg) return null;
    await this.opts.transport
      .publish(merossCmdTopic(cfg.uuid), buildSystemAll(this.ctx(cfg)))
      .catch(() => undefined);
    return merossToIotDevice(cfg, ref.channel, this.cache.get(cfg.uuid)?.get(ref.channel));
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const ref = parseMerossId(id);
    const cfg = ref && this.byUuid.get(ref.uuid);
    if (!ref || !cfg) throw new IotError('IOT_NOT_FOUND', 'Dispositivo Meross no encontrado');

    if (input.on !== undefined) {
      await this.opts.transport.publish(
        merossCmdTopic(cfg.uuid),
        buildToggleX(ref.channel, input.on, this.ctx(cfg)),
      );
      // Actualización optimista de la caché.
      const states = this.cache.get(cfg.uuid) ?? new Map<number, ChannelState>();
      const prev = states.get(ref.channel);
      states.set(ref.channel, {
        on: input.on,
        brightness: prev?.brightness ?? null,
        color: prev?.color ?? null,
        isLight: prev?.isLight ?? false,
      });
      this.cache.set(cfg.uuid, states);
    }
    return merossToIotDevice(cfg, ref.channel, this.cache.get(cfg.uuid)?.get(ref.channel));
  }
}
