import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { buildLightUpdate, parseLights } from './hue.parsers.js';
import type { HueClient } from './hue.transport.js';
import { IotError } from './mock.iot.js';

export interface HueIotOptions {
  client: HueClient;
}

/**
 * Integración IoT real sobre el **Philips Hue bridge** (CLIP API v2). Lista las
 * luces (`/resource/light`) y las controla con PUT (on/brillo/color/temperatura).
 * La conversión de color y el mapeo son puros (`hue.parsers`); aquí se orquesta
 * el cliente. Solo gestiona luces (el bridge expone luces).
 */
export class HueIotManager implements IotManager {
  readonly kind = 'hue' as const;

  constructor(private readonly opts: HueIotOptions) {}

  async listDevices(): Promise<IotDevice[]> {
    return parseLights(await this.opts.client.get('/clip/v2/resource/light'));
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    const [light] = parseLights(await this.opts.client.get(`/clip/v2/resource/light/${id}`));
    return light ?? null;
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const device = await this.getDevice(id);
    if (!device) throw new IotError('IOT_NOT_FOUND', 'Dispositivo no encontrado');

    await this.opts.client.put(`/clip/v2/resource/light/${id}`, buildLightUpdate(input));

    // Estado optimista (el bridge confirmará en la siguiente lectura).
    const next: IotDevice = { ...device };
    if (input.on !== undefined) next.on = input.on;
    if (input.brightness !== undefined) {
      next.brightness = input.brightness;
      if (input.on === undefined) next.on = input.brightness > 0;
    }
    if (input.color !== undefined && device.color !== null) {
      if (input.color.hex !== undefined) next.color = { hex: input.color.hex, temperatureK: null };
      else if (input.color.temperatureK !== undefined) {
        next.color = { hex: null, temperatureK: input.color.temperatureK };
      }
    }
    return next;
  }
}
