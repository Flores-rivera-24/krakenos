import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { IotError } from './mock.iot.js';
import {
  buildCommands,
  parseDeviceList,
  parseDeviceStatus,
  parseSwitchBotId,
} from './switchbot.parsers.js';
import type { SwitchBotTransport } from './switchbot.transport.js';

export interface SwitchBotIotOptions {
  transport: SwitchBotTransport;
}

/**
 * Integración IoT para **SwitchBot** vía la API REST local del Hub Mini/Hub 2.
 * `listDevices` consulta `/v1.0/devices` (filtrando los tipos soportados),
 * `getDevice` lee `/v1.0/devices/<id>/status` y `setState` postea comandos a
 * `/v1.0/devices/<id>/commands`. El protocolo es puro (`switchbot.parsers`); el
 * transporte HTTP es inyectable.
 */
export class SwitchBotIotManager implements IotManager {
  readonly kind = 'switchbot' as const;

  constructor(private readonly opts: SwitchBotIotOptions) {}

  async listDevices(): Promise<IotDevice[]> {
    return parseDeviceList(await this.opts.transport.get('/v1.0/devices'));
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    const deviceId = parseSwitchBotId(id);
    if (!deviceId) return null;
    try {
      return parseDeviceStatus(await this.opts.transport.get(`/v1.0/devices/${deviceId}/status`));
    } catch {
      return null;
    }
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const deviceId = parseSwitchBotId(id);
    if (!deviceId) throw new IotError('IOT_NOT_FOUND', 'Dispositivo SwitchBot no encontrado');

    for (const cmd of buildCommands(input)) {
      await this.opts.transport.post(`/v1.0/devices/${deviceId}/commands`, cmd);
    }

    const device = await this.getDevice(id);
    if (!device) throw new IotError('IOT_NOT_FOUND', 'Dispositivo SwitchBot no encontrado');
    return device;
  }
}
