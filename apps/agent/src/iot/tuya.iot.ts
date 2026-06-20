import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { IotError } from './mock.iot.js';
import { dpsToIotDevice, stateToTuyaPayload } from './tuya.parsers.js';
import type { TuyaDeviceConfig, TuyaStore } from './tuya.store.js';
import type { TuyaTransport } from './tuya.transport.js';

export interface TuyaIotOptions {
  /** Store de configuración por dispositivo (fuente de verdad de id/clave/ip). */
  store: TuyaStore;
  /** Transporte hacia los dispositivos (TCP+AES vía tuyapi, o mock en tests). */
  transport: TuyaTransport;
}

/**
 * Integración IoT real sobre el **protocolo Tuya local** (focos Tuya/Amazon
 * genéricos como EASYTAO). El `store` de config es la fuente de verdad (un
 * registro por dispositivo: id + localKey + ip); el manager conecta a cada
 * dispositivo, lee/escribe sus DPS vía el transporte y cachea el último estado
 * conocido en memoria. Si un dispositivo no responde, lo devuelve con el último
 * estado y `reachable: false`. Local-first: control por petición, sin nube.
 */
export class TuyaIotManager implements IotManager {
  readonly kind = 'tuya' as const;
  /** Último estado conocido por deviceId (el store es la verdad de config). */
  private readonly cache = new Map<string, IotDevice>();

  constructor(private readonly opts: TuyaIotOptions) {}

  /** Tuya es por petición (sin suscripción push); no hay nada que arrancar. */
  async start(): Promise<void> {}

  async listDevices(): Promise<IotDevice[]> {
    const configs = await this.opts.store.list();
    return Promise.all(configs.map((config) => this.readDevice(config)));
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    const config = await this.opts.store.get(id);
    if (!config) return null;
    return this.readDevice(config);
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const config = await this.opts.store.get(id);
    if (!config) throw new IotError('IOT_NOT_FOUND', 'Dispositivo no encontrado');

    const dps = stateToTuyaPayload(input);
    const handle = await this.opts.transport.connect(config);
    try {
      if (Object.keys(dps).length > 0) await handle.set(dps);
      const current = await handle.get();
      const device = dpsToIotDevice(config, current);
      this.cache.set(id, device);
      return device;
    } finally {
      handle.disconnect();
    }
  }

  /** Conecta, lee DPS y cachea; si el dispositivo no responde, último estado offline. */
  private async readDevice(config: TuyaDeviceConfig): Promise<IotDevice> {
    try {
      const handle = await this.opts.transport.connect(config);
      try {
        const device = dpsToIotDevice(config, await handle.get());
        this.cache.set(config.deviceId, device);
        return device;
      } finally {
        handle.disconnect();
      }
    } catch {
      const last = this.cache.get(config.deviceId);
      if (last) return { ...last, reachable: false };
      // Nunca visto y no responde: stub apagado/inalcanzable.
      return {
        id: config.deviceId,
        name: config.name || `Tuya ${config.deviceId}`,
        kind: 'light',
        room: null,
        reachable: false,
        on: null,
        brightness: null,
        color: null,
        reading: null,
      };
    }
  }
}
