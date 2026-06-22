import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { IotError } from './mock.iot.js';
import {
  type ShellyDeviceConfig,
  gen1LightPath,
  gen1RelayPath,
  gen2LightGetStatus,
  gen2LightSet,
  gen2SwitchGetStatus,
  gen2SwitchSet,
  parseGen1Status,
  parseGen2Channel,
  parseShellyId,
} from './shelly.parsers.js';
import type { ShellyTransport } from './shelly.transport.js';

export interface ShellyIotOptions {
  transport: ShellyTransport;
  /** Dispositivos configurados (`SHELLY_DEVICES`); no hay discovery fiable. */
  devices: ShellyDeviceConfig[];
}

/**
 * Integración IoT para **Shelly** (Gen1 REST + Gen2 JSON-RPC), local-first sin
 * nube. Los dispositivos se configuran a mano (`SHELLY_DEVICES`); cada canal se
 * expone como un `IotDevice` con id `shelly:<ip>:<channel>`. El protocolo es puro
 * (`shelly.parsers`); el transporte HTTP es inyectable.
 */
export class ShellyIotManager implements IotManager {
  readonly kind = 'shelly' as const;
  private readonly byIp = new Map<string, ShellyDeviceConfig>();

  constructor(private readonly opts: ShellyIotOptions) {
    for (const d of opts.devices) this.byIp.set(d.ip, { channels: 1, type: 'relay', ...d });
  }

  async listDevices(): Promise<IotDevice[]> {
    const lists = await Promise.all(
      [...this.byIp.values()].map((cfg) => this.readDevice(cfg).catch(() => [])),
    );
    return lists.flat();
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    const ref = parseShellyId(id);
    if (!ref) return null;
    const cfg = this.byIp.get(ref.ip);
    if (!cfg) return null;
    const devices = await this.readDevice(cfg).catch(() => []);
    return devices.find((d) => d.id === `shelly:${ref.ip}:${ref.channel}`) ?? null;
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const ref = parseShellyId(id);
    const cfg = ref && this.byIp.get(ref.ip);
    if (!ref || !cfg) throw new IotError('IOT_NOT_FOUND', 'Dispositivo Shelly no encontrado');

    if (cfg.gen === 1) await this.applyGen1(cfg, ref.channel, input);
    else await this.applyGen2(cfg, ref.channel, input);

    const device = await this.getDevice(id);
    if (!device) throw new IotError('IOT_NOT_FOUND', 'Dispositivo Shelly no encontrado');
    return device;
  }

  /** Lee el estado de todos los canales de un dispositivo. */
  private async readDevice(cfg: ShellyDeviceConfig): Promise<IotDevice[]> {
    if (cfg.gen === 1) {
      return parseGen1Status(cfg, await this.opts.transport.get(cfg.ip, '/status'));
    }
    const channels = cfg.channels ?? 1;
    const out: IotDevice[] = [];
    for (let ch = 0; ch < channels; ch++) {
      const status =
        cfg.type === 'light'
          ? await this.opts.transport.rpc(cfg.ip, gen2LightGetStatus(ch))
          : await this.opts.transport.rpc(cfg.ip, gen2SwitchGetStatus(ch));
      out.push(parseGen2Channel(cfg, ch, status));
    }
    return out;
  }

  private async applyGen1(cfg: ShellyDeviceConfig, channel: number, input: UpdateIotStateRequest): Promise<void> {
    if (cfg.type === 'light') {
      await this.opts.transport.get(cfg.ip, gen1LightPath(channel, input));
    } else if (input.on !== undefined) {
      await this.opts.transport.get(cfg.ip, gen1RelayPath(channel, input.on));
    }
  }

  private async applyGen2(cfg: ShellyDeviceConfig, channel: number, input: UpdateIotStateRequest): Promise<void> {
    if (cfg.type === 'light') {
      await this.opts.transport.rpc(cfg.ip, gen2LightSet(channel, input));
    } else if (input.on !== undefined) {
      await this.opts.transport.rpc(cfg.ip, gen2SwitchSet(channel, input.on));
    }
  }
}
