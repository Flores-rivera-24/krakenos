import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import {
  GOVEE_CONTROL_PORT,
  GOVEE_MULTICAST,
  GOVEE_SCAN_PORT,
  type GoveeDevice,
  buildBrightness,
  buildColorRgb,
  buildColorTemp,
  buildScan,
  buildStatus,
  buildTurn,
  goveeToIotDevice,
  parseGoveeMessage,
} from './govee.parsers.js';
import type { UdpTransport } from './govee.transport.js';
import { IotError } from './mock.iot.js';

export interface GoveeIotOptions {
  transport: UdpTransport;
}

/**
 * Integración IoT real sobre la **API LAN de Govee** (UDP, local). Descubre los
 * dispositivos por multicast, sigue su estado por los datagramas de respuesta y
 * los controla enviando comandos a su IP. Mantiene una caché en memoria; los
 * builders/parsers son puros (`govee.parsers`). Local-first: no usa la nube.
 *
 * Baseline: `listDevices` dispara un scan y devuelve la caché actual (las
 * respuestas UDP llegan de forma asíncrona y la van poblando).
 */
export class GoveeIotManager implements IotManager {
  readonly kind = 'govee' as const;
  private readonly devices = new Map<string, GoveeDevice>();
  private readonly byIp = new Map<string, string>();
  private started = false;

  constructor(private readonly opts: GoveeIotOptions) {}

  /** Registra el handler de mensajes y lanza un primer discovery (idempotente). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.opts.transport.onMessage((payload, fromIp) => this.onMessage(payload, fromIp));
    await this.discover();
  }

  private async discover(): Promise<void> {
    await this.opts.transport.sendMulticast(GOVEE_MULTICAST, GOVEE_SCAN_PORT, buildScan());
  }

  private onMessage(payload: string, fromIp: string): void {
    const parsed = parseGoveeMessage(payload);
    if (!parsed) return;
    if (parsed.cmd === 'scan') {
      const ip = typeof parsed.data.ip === 'string' ? parsed.data.ip : fromIp;
      const id = typeof parsed.data.device === 'string' ? parsed.data.device : null;
      if (!id) return;
      const sku = typeof parsed.data.sku === 'string' ? parsed.data.sku : null;
      const existing = this.devices.get(id);
      this.devices.set(id, { id, ip, sku, state: existing?.state ?? null });
      this.byIp.set(ip, id);
      // Pide el estado inicial del dispositivo recién visto.
      void this.opts.transport.send(ip, GOVEE_CONTROL_PORT, buildStatus());
    } else if (parsed.cmd === 'devStatus') {
      // La respuesta de estado no trae id: se asocia por la IP de origen.
      const id = this.byIp.get(fromIp);
      const dev = id ? this.devices.get(id) : undefined;
      if (dev) dev.state = { ...(dev.state ?? {}), ...parsed.data };
    }
  }

  async listDevices(): Promise<IotDevice[]> {
    void this.discover(); // refresco best-effort, no bloquea
    return [...this.devices.values()].map(goveeToIotDevice);
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    const dev = this.devices.get(id);
    return dev ? goveeToIotDevice(dev) : null;
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const dev = this.devices.get(id);
    if (!dev) throw new IotError('IOT_NOT_FOUND', 'Dispositivo no encontrado');
    const send = (payload: string) => this.opts.transport.send(dev.ip, GOVEE_CONTROL_PORT, payload);

    const nextState: Record<string, unknown> = { ...(dev.state ?? {}) };
    if (input.on !== undefined) {
      await send(buildTurn(input.on));
      nextState.onOff = input.on ? 1 : 0;
    }
    if (input.brightness !== undefined) {
      await send(buildBrightness(input.brightness));
      nextState.brightness = input.brightness;
      if (input.on === undefined) nextState.onOff = input.brightness > 0 ? 1 : 0;
    }
    if (input.color?.hex !== undefined) {
      await send(buildColorRgb(input.color.hex));
      nextState.color = hexToRgbObj(input.color.hex);
      nextState.colorTemInKelvin = 0;
    } else if (input.color?.temperatureK !== undefined) {
      await send(buildColorTemp(input.color.temperatureK));
      nextState.colorTemInKelvin = input.color.temperatureK;
    }
    dev.state = nextState;
    return goveeToIotDevice(dev);
  }
}

/** RGB para el estado optimista (evita reimportar el builder solo para esto). */
function hexToRgbObj(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
