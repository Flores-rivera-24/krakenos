import type { IotColor, IotDevice, IotDeviceKind } from '@krakenos/types';

/**
 * Builders/parsers **puros** para **SwitchBot** vía la API REST local del Hub
 * Mini/Hub 2 (`/v1.0/devices`, `/v1.0/devices/<id>/commands|status`). Aquí vive
 * la lógica testeable: filtrar los tipos soportados, mapear a `IotDevice` y
 * construir los comandos. El transporte HTTP es inyectable.
 */

/** Comando a enviar a `/v1.0/devices/<id>/commands`. */
export interface SwitchBotCommand {
  command: string;
  parameter: string | number;
  commandType: string;
}

/** Devuelve el tipo de IoT para un `deviceType` SwitchBot, o `null` si no se soporta. */
export function supportedKind(deviceType: string): IotDeviceKind | null {
  if (/plug|bot/i.test(deviceType)) return 'plug';
  if (/color bulb|strip light|ceiling light/i.test(deviceType)) return 'light';
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Desempaqueta `body.deviceList` (o un array directo) a registros. */
function deviceList(body: unknown): Record<string, unknown>[] {
  const list = (body as { deviceList?: unknown } | null)?.deviceList ?? body;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

/**
 * Mapea `GET /v1.0/devices` a `IotDevice[]`, **filtrando los tipos soportados**
 * (Bot, Plug Mini, Color Bulb, Strip Light, Ceiling Light). El estado on/off real
 * se consulta con `getDevice` (la lista no lo trae): aquí `on=false`/reachable.
 */
export function parseDeviceList(body: unknown): IotDevice[] {
  const out: IotDevice[] = [];
  for (const entry of deviceList(body)) {
    const deviceId = str(entry.deviceId);
    const deviceType = str(entry.deviceType);
    if (!deviceId || !deviceType) continue;
    const kind = supportedKind(deviceType);
    if (!kind) continue;
    out.push({
      id: `switchbot:${deviceId}`,
      name: str(entry.deviceName) ?? deviceType,
      kind,
      room: null,
      reachable: true,
      on: false,
      brightness: null,
      color: null,
      reading: null,
    });
  }
  return out;
}

/** Convierte un color SwitchBot `"r:g:b"` a hex `#rrggbb`. */
export function rgbStringToHex(value: string): string | null {
  const parts = value.split(':').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return `#${parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
}

/** Convierte hex `#rrggbb` a `"r:g:b"` (parámetro de `setColor`). */
export function hexToRgbString(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 0xff}:${(n >> 8) & 0xff}:${n & 0xff}`;
}

/**
 * Mapea `GET /v1.0/devices/<id>/status` a un `IotDevice`. Lee `power` (on/off),
 * `brightness` (1-100) y `color`/`colorTemperature` para luces. El `deviceType`
 * viene en el propio status.
 */
export function parseDeviceStatus(body: unknown): IotDevice | null {
  const s = (body ?? {}) as Record<string, unknown>;
  const deviceId = str(s.deviceId);
  const deviceType = str(s.deviceType) ?? '';
  if (!deviceId) return null;
  const kind = supportedKind(deviceType) ?? 'plug';
  const isLight = kind === 'light';

  let color: IotColor | null = null;
  if (isLight) {
    const temp = num(s.colorTemperature);
    const rgb = str(s.color);
    if (rgb && rgb !== '0:0:0') {
      const hex = rgbStringToHex(rgb);
      if (hex) color = { hex, temperatureK: null };
    } else if (temp) {
      color = { hex: null, temperatureK: temp };
    }
  }

  return {
    id: `switchbot:${deviceId}`,
    name: str(s.deviceName) ?? (deviceType || deviceId),
    kind,
    room: null,
    reachable: true,
    on: s.power === 'on' || s.power === 'ON' || s.power === true,
    brightness: isLight ? num(s.brightness) : null,
    color,
    reading: null,
  };
}

/** Construye la lista de comandos para aplicar un cambio de estado. */
export function buildCommands(input: {
  on?: boolean;
  brightness?: number;
  color?: { hex?: string; temperatureK?: number };
}): SwitchBotCommand[] {
  const cmds: SwitchBotCommand[] = [];
  if (input.on !== undefined) {
    cmds.push({ command: input.on ? 'turnOn' : 'turnOff', parameter: 'default', commandType: 'command' });
  }
  if (input.brightness !== undefined) {
    cmds.push({
      command: 'setBrightness',
      parameter: Math.max(1, Math.min(100, Math.round(input.brightness))),
      commandType: 'command',
    });
  }
  if (input.color?.hex !== undefined) {
    cmds.push({ command: 'setColor', parameter: hexToRgbString(input.color.hex), commandType: 'command' });
  } else if (input.color?.temperatureK !== undefined) {
    cmds.push({
      command: 'setColorTemperature',
      parameter: Math.round(input.color.temperatureK),
      commandType: 'command',
    });
  }
  return cmds;
}

/** Separa un id `switchbot:<deviceId>` en el deviceId. */
export function parseSwitchBotId(id: string): string | null {
  const bare = id.startsWith('switchbot:') ? id.slice('switchbot:'.length) : id;
  return bare.length > 0 ? bare : null;
}
