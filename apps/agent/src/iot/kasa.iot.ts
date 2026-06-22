import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import {
  KASA_SYSINFO,
  buildKasaBrightness,
  buildKasaLightState,
  buildKasaRelay,
  buildTapoSetBrightness,
  buildTapoSetColor,
  buildTapoSetOn,
  hexToHsv,
  kasaToIotDevice,
  parseKasaSysinfo,
  parseTapoDeviceInfo,
  tapoToIotDevice,
} from './kasa.parsers.js';
import type { KasaTransport, TapoTransport } from './kasa.transport.js';
import { IotError } from './mock.iot.js';

export interface KasaIotOptions {
  /** Transporte Kasa (Gen1/2). */
  kasa: KasaTransport;
  /** Transporte Tapo (Gen3+); ausente si no hay credenciales/dispositivos Tapo. */
  tapo?: TapoTransport;
  /** IPs Kasa configuradas manualmente (además del broadcast). */
  kasaIps?: string[];
  /** IPs Tapo configuradas manualmente. */
  tapoIps?: string[];
}

/**
 * Integración IoT para TP-Link **Kasa** (Gen1/2, XOR local) y **Tapo** (Gen3+,
 * KLAP), local-first (sin nube). `listDevices` combina el broadcast Kasa, el
 * descubrimiento Tapo y los dispositivos configurados; el id lleva el prefijo
 * `kasa:`/`tapo:` para enrutar `getDevice`/`setState` a la subfamilia correcta.
 * La lógica de protocolo es pura (`kasa.parsers`); el transporte es inyectable.
 */
export class KasaIotManager implements IotManager {
  readonly kind = 'kasa' as const;

  constructor(private readonly opts: KasaIotOptions) {}

  async listDevices(): Promise<IotDevice[]> {
    const devices: IotDevice[] = [];

    // --- Kasa: broadcast + IPs configuradas no descubiertas ---
    const seenKasa = new Set<string>();
    try {
      for (const d of await this.opts.kasa.discover()) {
        const state = parseKasaSysinfo(d.ip, d.sysinfo);
        if (state) {
          seenKasa.add(d.ip);
          devices.push(kasaToIotDevice(state));
        }
      }
    } catch {
      // discovery best-effort
    }
    for (const ip of this.opts.kasaIps ?? []) {
      if (seenKasa.has(ip)) continue;
      const dev = await this.fetchKasa(ip).catch(() => null);
      if (dev) devices.push(dev);
    }

    // --- Tapo: descubrimiento + IPs configuradas ---
    if (this.opts.tapo) {
      const tapoIps = new Set(this.opts.tapoIps ?? []);
      try {
        for (const ip of await this.opts.tapo.discover()) tapoIps.add(ip);
      } catch {
        // discovery best-effort
      }
      for (const ip of tapoIps) {
        const dev = await this.fetchTapo(ip).catch(() => null);
        if (dev) devices.push(dev);
      }
    }

    return devices;
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    const { family, ip } = parseDeviceId(id);
    if (family === 'kasa') return this.fetchKasa(ip).catch(() => null);
    if (family === 'tapo' && this.opts.tapo) return this.fetchTapo(ip).catch(() => null);
    return null;
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const { family, ip } = parseDeviceId(id);
    if (family === 'kasa') return this.setKasa(ip, input);
    if (family === 'tapo') return this.setTapo(ip, input);
    throw new IotError('IOT_NOT_FOUND', 'Dispositivo no encontrado');
  }

  // ---- Kasa ----

  private async fetchKasa(ip: string): Promise<IotDevice> {
    const state = parseKasaSysinfo(ip, await this.opts.kasa.send(ip, KASA_SYSINFO));
    if (!state) throw new IotError('IOT_NOT_FOUND', 'Dispositivo Kasa no encontrado');
    return kasaToIotDevice(state);
  }

  private async setKasa(ip: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const current = await this.fetchKasa(ip);
    if (current.kind === 'light') {
      const light: Parameters<typeof buildKasaLightState>[0] = {};
      if (input.on !== undefined) light.on = input.on;
      if (input.brightness !== undefined) {
        light.brightness = input.brightness;
        if (input.on === undefined) light.on = input.brightness > 0;
      }
      if (input.color?.hex !== undefined) {
        const hsv = hexToHsv(input.color.hex);
        light.hue = hsv.hue;
        light.saturation = hsv.saturation;
      } else if (input.color?.temperatureK !== undefined) {
        light.colorTemp = input.color.temperatureK;
      }
      await this.opts.kasa.send(ip, buildKasaLightState(light));
    } else {
      if (input.on !== undefined) await this.opts.kasa.send(ip, buildKasaRelay(input.on));
      if (input.brightness !== undefined) await this.opts.kasa.send(ip, buildKasaBrightness(input.brightness));
    }
    return this.fetchKasa(ip);
  }

  // ---- Tapo ----

  private async fetchTapo(ip: string): Promise<IotDevice> {
    if (!this.opts.tapo) throw new IotError('IOT_NOT_FOUND', 'Tapo no configurado');
    return tapoToIotDevice(parseTapoDeviceInfo(ip, await this.opts.tapo.request(ip, 'get_device_info')));
  }

  private async setTapo(ip: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    if (!this.opts.tapo) throw new IotError('IOT_NOT_FOUND', 'Tapo no configurado');
    const send = (cmd: { method: string; params?: Record<string, unknown> }) =>
      this.opts.tapo!.request(ip, cmd.method, cmd.params);
    if (input.on !== undefined) await send(buildTapoSetOn(input.on));
    if (input.brightness !== undefined) await send(buildTapoSetBrightness(input.brightness));
    if (input.color?.hex !== undefined) {
      const hsv = hexToHsv(input.color.hex);
      await send(buildTapoSetColor({ hue: hsv.hue, saturation: hsv.saturation }));
    } else if (input.color?.temperatureK !== undefined) {
      await send(buildTapoSetColor({ colorTempK: input.color.temperatureK }));
    }
    return this.fetchTapo(ip);
  }
}

/** Separa un id `kasa:<ip>` / `tapo:<ip>` en familia + IP. */
function parseDeviceId(id: string): { family: string; ip: string } {
  const i = id.indexOf(':');
  return i === -1 ? { family: '', ip: id } : { family: id.slice(0, i), ip: id.slice(i + 1) };
}
