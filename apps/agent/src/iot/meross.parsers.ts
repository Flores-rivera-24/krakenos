import { createHash } from 'node:crypto';
import type { IotColor, IotDevice } from '@krakenos/types';

/**
 * Builders/parsers **puros** para **Meross** sobre MQTT local. Los dispositivos
 * Meross hablan un protocolo de mensajes firmados (`header`+`payload`, firma
 * `md5(messageId + key + timestamp)`). Aquí vive la lógica testeable: construir
 * mensajes firmados, los topics y mapear `Appliance.System.All` a `IotDevice`.
 * El transporte MQTT es inyectable.
 */

/** Config de un dispositivo Meross (de `MEROSS_DEVICES`). */
export interface MerossDeviceConfig {
  uuid: string;
  name?: string;
  /** Nº de canales (multi-enchufe). Por defecto 1. */
  channels?: number;
  /** Clave del dispositivo (de la cuenta Meross); firma los mensajes. */
  key: string;
}

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

// ---- Topics ----

/** Topic donde se publican los comandos a un dispositivo. */
export function merossCmdTopic(uuid: string): string {
  return `m/v1/${uuid}/subscribe`;
}

/** Topic donde el dispositivo publica respuestas/PUSH. */
export function merossRespTopic(uuid: string): string {
  return `m/v1/${uuid}/publish`;
}

/** Filtro MQTT para todas las respuestas de dispositivos. */
export const MEROSS_RESP_FILTER = 'm/v1/+/publish';

/** Extrae el `uuid` de un topic `m/v1/<uuid>/publish`. */
export function uuidFromTopic(topic: string): string | null {
  const m = topic.match(/^m\/v1\/([^/]+)\/publish$/);
  return m ? m[1]! : null;
}

// ---- Construcción de mensajes firmados ----

export interface MerossMessageParams {
  namespace: string;
  method: 'GET' | 'SET' | 'PUSH';
  payload: Record<string, unknown>;
  key: string;
  /** Inyectables para tests deterministas. */
  messageId: string;
  timestamp: number;
  /** Topic `from` para la respuesta (por defecto el de la app). */
  from?: string;
}

/** Construye el JSON firmado de un mensaje Meross. */
export function buildMerossMessage(params: MerossMessageParams): string {
  const sign = md5(`${params.messageId}${params.key}${params.timestamp}`);
  return JSON.stringify({
    header: {
      messageId: params.messageId,
      namespace: params.namespace,
      method: params.method,
      payloadVersion: 1,
      from: params.from ?? '/app/krakenos/subscribe',
      timestamp: params.timestamp,
      sign,
    },
    payload: params.payload,
  });
}

/** Mensaje SET `Appliance.Control.ToggleX` (enciende/apaga un canal). */
export function buildToggleX(
  channel: number,
  on: boolean,
  ctx: { key: string; messageId: string; timestamp: number },
): string {
  return buildMerossMessage({
    namespace: 'Appliance.Control.ToggleX',
    method: 'SET',
    payload: { togglex: { channel, onoff: on ? 1 : 0 } },
    ...ctx,
  });
}

/** Mensaje GET `Appliance.System.All` (estado completo del dispositivo). */
export function buildSystemAll(ctx: { key: string; messageId: string; timestamp: number }): string {
  return buildMerossMessage({
    namespace: 'Appliance.System.All',
    method: 'GET',
    payload: {},
    ...ctx,
  });
}

// ---- Parseo de estado ----

interface ParsedMessage {
  namespace: string;
  payload: Record<string, unknown>;
}

/** Extrae `{namespace, payload}` de un mensaje Meross recibido (JSON). */
export function parseMerossMessage(text: string): ParsedMessage | null {
  try {
    const msg = JSON.parse(text) as { header?: { namespace?: unknown }; payload?: unknown };
    const namespace = typeof msg.header?.namespace === 'string' ? msg.header.namespace : null;
    if (!namespace) return null;
    return { namespace, payload: (msg.payload ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Estado on/off por canal (y brillo/color de luces) extraído del `digest` de un
 * `Appliance.System.All` o de un PUSH `ToggleX`. Mapa `channel → estado`.
 */
export interface ChannelState {
  on: boolean;
  brightness: number | null;
  color: IotColor | null;
  isLight: boolean;
}

/** Extrae el estado por canal del payload (digest.togglex/light o control.toggle). */
export function extractChannelStates(payload: Record<string, unknown>): Map<number, ChannelState> {
  const out = new Map<number, ChannelState>();
  const all = (payload.all ?? payload) as Record<string, unknown>;
  const digest = (all.digest ?? {}) as Record<string, unknown>;

  for (const t of asArray(digest.togglex)) {
    const ch = num(t.channel) ?? 0;
    out.set(ch, { on: t.onoff === 1, brightness: null, color: null, isLight: false });
  }
  // Dispositivos antiguos de un solo canal: `control.toggle`.
  const toggle = ((all.control ?? {}) as Record<string, unknown>).toggle as Record<string, unknown> | undefined;
  if (toggle && !out.has(0)) {
    out.set(0, { on: toggle.onoff === 1, brightness: null, color: null, isLight: false });
  }
  // Luces: digest.light (luminance 0-100, rgb entero).
  for (const l of asArray(digest.light)) {
    const ch = num(l.channel) ?? 0;
    const rgb = num(l.rgb);
    const color: IotColor | null = rgb !== null ? { hex: rgbIntToHex(rgb), temperatureK: null } : null;
    const existing = out.get(ch);
    out.set(ch, {
      on: existing?.on ?? l.onoff === 1,
      brightness: num(l.luminance),
      color,
      isLight: true,
    });
  }
  return out;
}

/** Convierte un entero RGB (0xRRGGBB) a hex `#rrggbb`. */
export function rgbIntToHex(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Construye el `IotDevice` de un canal a partir de la config y el estado. */
export function merossToIotDevice(
  cfg: MerossDeviceConfig,
  channel: number,
  state: ChannelState | undefined,
): IotDevice {
  const channels = cfg.channels ?? 1;
  const base = cfg.name ?? `Meross ${cfg.uuid.slice(0, 6)}`;
  return {
    id: `meross:${cfg.uuid}:${channel}`,
    name: channels > 1 ? `${base} (${channel + 1})` : base,
    kind: state?.isLight ? 'light' : 'plug',
    room: null,
    reachable: state !== undefined,
    on: state?.on ?? false,
    brightness: state?.brightness ?? null,
    color: state?.color ?? null,
    reading: null,
  };
}

/** Separa un id `meross:<uuid>:<channel>` en uuid + canal. */
export function parseMerossId(id: string): { uuid: string; channel: number } | null {
  const bare = id.startsWith('meross:') ? id.slice('meross:'.length) : id;
  const sep = bare.lastIndexOf(':');
  if (sep === -1) return null;
  const uuid = bare.slice(0, sep);
  const channel = Number.parseInt(bare.slice(sep + 1), 10);
  if (!uuid || Number.isNaN(channel)) return null;
  return { uuid, channel };
}
