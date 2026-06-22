import type { IotDevice, IotReading } from '@krakenos/types';

/**
 * Builders/parsers **puros** para **Shelly**, que cubren las dos generaciones:
 * - **Gen1**: REST HTTP (`GET /relay/0?turn=on`, estado en `GET /status`).
 * - **Gen2/Gen3** (Plus/Pro/Mini): JSON-RPC sobre HTTP (`POST /rpc`,
 *   `Switch.Set`/`Switch.GetStatus`).
 *
 * El transporte HTTP es inyectable; aquí solo vive la lógica testeable (rutas,
 * cuerpos JSON-RPC y mapeo a `IotDevice`). El id de cada canal es
 * `shelly:<ip>:<channel>` (un dispositivo físico con N canales → N `IotDevice`).
 */

/** Tipo de canal Shelly: relé (enchufe) o luz (dimmer/RGBW con brillo). */
export type ShellyChannelType = 'relay' | 'light';

/** Config de un dispositivo Shelly (de `SHELLY_DEVICES`). */
export interface ShellyDeviceConfig {
  ip: string;
  name?: string;
  /** Generación del protocolo (1 = REST, 2 = JSON-RPC). */
  gen: 1 | 2;
  /** Nº de canales (Shelly 2.5 → 2). Por defecto 1. */
  channels?: number;
  /** Tipo de canal (por defecto `relay`). `light` habilita el brillo. */
  type?: ShellyChannelType;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// ---- Gen1: rutas REST ----

/** Ruta para conmutar un relé Gen1: `/relay/<ch>?turn=on|off`. */
export function gen1RelayPath(channel: number, on: boolean): string {
  return `/relay/${channel}?turn=${on ? 'on' : 'off'}`;
}

/** Ruta para una luz/dimmer Gen1: `/light/<ch>?turn=…&brightness=…`. */
export function gen1LightPath(channel: number, input: { on?: boolean; brightness?: number }): string {
  const params: string[] = [];
  if (input.on !== undefined) params.push(`turn=${input.on ? 'on' : 'off'}`);
  if (input.brightness !== undefined) params.push(`brightness=${clampPct(input.brightness)}`);
  return `/light/${channel}?${params.join('&')}`;
}

// ---- Gen2: cuerpos JSON-RPC ----

export interface RpcCommand {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

let rpcId = 0;
function nextRpcId(): number {
  rpcId = (rpcId + 1) % 1_000_000;
  return rpcId;
}

export function gen2SwitchSet(channel: number, on: boolean): RpcCommand {
  return { id: nextRpcId(), method: 'Switch.Set', params: { id: channel, on } };
}

export function gen2SwitchGetStatus(channel: number): RpcCommand {
  return { id: nextRpcId(), method: 'Switch.GetStatus', params: { id: channel } };
}

export function gen2LightSet(channel: number, input: { on?: boolean; brightness?: number }): RpcCommand {
  const params: Record<string, unknown> = { id: channel };
  if (input.on !== undefined) params.on = input.on;
  if (input.brightness !== undefined) params.brightness = clampPct(input.brightness);
  return { id: nextRpcId(), method: 'Light.Set', params };
}

export function gen2LightGetStatus(channel: number): RpcCommand {
  return { id: nextRpcId(), method: 'Light.GetStatus', params: { id: channel } };
}

// ---- Parseo a IotDevice ----

function powerReading(power: number | null): IotReading | null {
  return power !== null ? { metric: 'potencia', value: Math.round(power * 10) / 10, unit: 'W' } : null;
}

function deviceId(ip: string, channel: number): string {
  return `shelly:${ip}:${channel}`;
}

function channelName(cfg: ShellyDeviceConfig, channel: number): string {
  const base = cfg.name ?? `Shelly ${cfg.ip}`;
  return (cfg.channels ?? 1) > 1 ? `${base} (${channel + 1})` : base;
}

/**
 * Mapea el `GET /status` de un Shelly Gen1 a `IotDevice[]` (uno por canal). Lee
 * `relays`/`lights` según el tipo configurado y la potencia de `meters`.
 */
export function parseGen1Status(cfg: ShellyDeviceConfig, status: unknown): IotDevice[] {
  const s = (status ?? {}) as Record<string, unknown>;
  const relays = Array.isArray(s.relays) ? (s.relays as Record<string, unknown>[]) : [];
  const lights = Array.isArray(s.lights) ? (s.lights as Record<string, unknown>[]) : [];
  const meters = Array.isArray(s.meters) ? (s.meters as Record<string, unknown>[]) : [];
  const channels = cfg.channels ?? 1;
  const isLight = cfg.type === 'light';

  const out: IotDevice[] = [];
  for (let ch = 0; ch < channels; ch++) {
    const power = num(meters[ch]?.power ?? null);
    if (isLight) {
      const l = lights[ch] ?? {};
      out.push({
        id: deviceId(cfg.ip, ch),
        name: channelName(cfg, ch),
        kind: 'light',
        room: null,
        reachable: true,
        on: l.ison === true,
        brightness: num(l.brightness),
        color: null,
        reading: powerReading(power),
      });
    } else {
      const r = relays[ch] ?? {};
      out.push({
        id: deviceId(cfg.ip, ch),
        name: channelName(cfg, ch),
        kind: 'plug',
        room: null,
        reachable: true,
        on: r.ison === true,
        brightness: null,
        color: null,
        reading: powerReading(power),
      });
    }
  }
  return out;
}

/**
 * Mapea el resultado de `Switch.GetStatus`/`Light.GetStatus` (Gen2) de un canal a
 * un `IotDevice`. `output` = encendido; `apower` = potencia (W); `brightness` solo
 * en luces.
 */
export function parseGen2Channel(cfg: ShellyDeviceConfig, channel: number, result: unknown): IotDevice {
  const r = (result ?? {}) as Record<string, unknown>;
  const isLight = cfg.type === 'light';
  return {
    id: deviceId(cfg.ip, channel),
    name: channelName(cfg, channel),
    kind: isLight ? 'light' : 'plug',
    room: null,
    reachable: true,
    on: r.output === true,
    brightness: isLight ? num(r.brightness) : null,
    color: null,
    reading: powerReading(num(r.apower)),
  };
}

/** Separa un id `shelly:<ip>:<channel>` (o `<ip>:<channel>`) en IP + canal. */
export function parseShellyId(id: string): { ip: string; channel: number } | null {
  const bare = id.startsWith('shelly:') ? id.slice('shelly:'.length) : id;
  const sep = bare.lastIndexOf(':');
  if (sep === -1) return null;
  const ip = bare.slice(0, sep);
  const channel = Number.parseInt(bare.slice(sep + 1), 10);
  if (!ip || Number.isNaN(channel)) return null;
  return { ip, channel };
}
