import type { DiscoveredDevice, WifiBand, WifiSecurity } from '@krakenos/types';

/**
 * Parsers **puros** de la salida de los comandos OpenWrt a los tipos del
 * contrato. Reciben el `stdout` ya capturado y no tocan la red, de modo que se
 * testean con fixtures representativas sin un router real.
 */

const ZERO_MAC = '00:00:00:00:00:00';

/**
 * Parsea `/proc/net/arp`. Formato (con cabecera):
 * `IP address  HW type  Flags  HW address  Mask  Device`.
 * Descarta entradas incompletas (flags `0x0`) y la MAC nula.
 */
export function parseArpTable(stdout: string): DiscoveredDevice[] {
  const out: DiscoveredDevice[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const [ip, , flags, hw] = cols as [string, string, string, string];
    const mac = hw.toLowerCase();
    if (flags === '0x0' || mac === ZERO_MAC || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
      continue;
    }
    if (seen.has(mac)) continue;
    seen.add(mac);
    out.push({ mac, ip, source: 'arp' });
  }
  return out;
}

/**
 * Parsea las concesiones DHCP de dnsmasq (`/tmp/dhcp.leases`):
 * `<expiry> <mac> <ip> <hostname> <clientid>`. Devuelve un mapa MAC→hostname
 * para enriquecer los dispositivos descubiertos.
 */
export function parseDhcpLeases(stdout: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const mac = cols[1]!.toLowerCase();
    const hostname = cols[3]!;
    if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) && hostname && hostname !== '*') {
      map.set(mac, hostname);
    }
  }
  return map;
}

/** Contadores rx/tx (bytes acumulados) de una interfaz. */
export interface IfaceCounters {
  rxBytes: number;
  txBytes: number;
}

/**
 * Parsea `/proc/net/dev` y devuelve los contadores de `iface`, o `null` si no
 * aparece. La línea es `iface: rxBytes ...(8 campos)... txBytes ...`.
 */
export function parseProcNetDev(stdout: string, iface: string): IfaceCounters | null {
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim();
    if (name !== iface) continue;
    const fields = line.slice(idx + 1).trim().split(/\s+/);
    if (fields.length < 16) continue;
    return { rxBytes: Number(fields[0]), txBytes: Number(fields[8]) };
  }
  return null;
}

// ---- uci show wireless ----

/** Una sección de la config wireless (radio `wifi-device` o iface `wifi-iface`). */
export interface UciSection {
  name: string;
  type: string;
  options: Record<string, string>;
}

export interface UciWireless {
  /** Radios (`wifi-device`) por nombre de sección, p. ej. `radio0`. */
  devices: Record<string, UciSection>;
  /** Interfaces (`wifi-iface`) en orden de aparición. */
  ifaces: UciSection[];
}

/**
 * Parsea `uci show wireless` en secciones. Líneas:
 * `wireless.<sec>=<type>` y `wireless.<sec>.<option>='<value>'`.
 */
export function parseUciWireless(stdout: string): UciWireless {
  const sections = new Map<string, UciSection>();
  const order: string[] = [];

  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (!line.startsWith('wireless.') || eq === -1) continue;
    const path = line.slice('wireless.'.length, eq);
    const value = unquote(line.slice(eq + 1));
    const dot = path.indexOf('.');
    if (dot === -1) {
      // Declaración de sección: `wireless.<sec>=<type>`.
      if (!sections.has(path)) {
        sections.set(path, { name: path, type: value, options: {} });
        order.push(path);
      } else {
        sections.get(path)!.type = value;
      }
    } else {
      const sec = path.slice(0, dot);
      const option = path.slice(dot + 1);
      if (!sections.has(sec)) {
        sections.set(sec, { name: sec, type: '', options: {} });
        order.push(sec);
      }
      sections.get(sec)!.options[option] = value;
    }
  }

  const devices: Record<string, UciSection> = {};
  const ifaces: UciSection[] = [];
  for (const name of order) {
    const sec = sections.get(name)!;
    if (sec.type === 'wifi-device') devices[name] = sec;
    else if (sec.type === 'wifi-iface') ifaces.push(sec);
  }
  return { devices, ifaces };
}

/** Quita las comillas simples que UCI pone alrededor de los valores. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1);
  return v;
}

/** Mapea el `encryption` de UCI a la seguridad de KrakenOS. */
export function securityFromUci(encryption: string | undefined): WifiSecurity {
  const e = (encryption ?? 'none').toLowerCase();
  if (e === 'none' || e.startsWith('owe')) return 'open';
  if (e.startsWith('sae-mixed')) return 'wpa2/wpa3';
  if (e.startsWith('sae')) return 'wpa3';
  return 'wpa2'; // psk2, psk2+ccmp, etc.
}

/** Deriva la banda a partir del radio (`band` o `hwmode` heredado). */
export function bandFromDevice(device: UciSection | undefined): WifiBand {
  const band = device?.options.band?.toLowerCase();
  if (band === '2g') return '2.4GHz';
  if (band === '6g') return '6GHz';
  if (band === '5g') return '5GHz';
  // Compat con `hwmode` antiguo: 11a/11ac/11ax(5GHz) vs 11b/11g/11n(2.4GHz).
  const hwmode = device?.options.hwmode?.toLowerCase() ?? '';
  if (hwmode.includes('a') || hwmode.includes('ac')) return '5GHz';
  return '2.4GHz';
}

/** `true` si la sección de iface corresponde a la red de invitados. */
export function isGuestIface(iface: UciSection, guestNetwork: string): boolean {
  return iface.options.network === guestNetwork;
}

/**
 * Parsea la `assoclist` de iwinfo. Cada cliente empieza con su MAC y la señal:
 * `F0:18:98:AA:BB:CC  -48 dBm / -95 dBm (SNR 47)  3000 ms ago`.
 * Devuelve MAC (minúsculas) y señal en dBm.
 */
export function parseIwinfoAssoc(stdout: string): { mac: string; signalDbm: number }[] {
  const out: { mac: string; signalDbm: number }[] = [];
  const re = /^([0-9A-Fa-f:]{17})\s+(-?\d+)\s*dBm/;
  for (const line of stdout.split('\n')) {
    const m = re.exec(line.trim());
    if (!m) continue;
    out.push({ mac: m[1]!.toLowerCase(), signalDbm: Number(m[2]) });
  }
  return out;
}

/**
 * Parsea `ubus call umdns hosts` (JSON). Devuelve `{hostname, ip}` por host
 * anunciado por mDNS; tolera variaciones de forma y la ausencia de IPv4.
 */
export function parseUmdnsHosts(json: unknown): { hostname: string; ip: string }[] {
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  // Algunas versiones envuelven en `{ host: { ... } }`; otras dan el mapa directo.
  const hosts =
    root.host && typeof root.host === 'object' ? (root.host as Record<string, unknown>) : root;
  const out: { hostname: string; ip: string }[] = [];
  for (const [key, value] of Object.entries(hosts)) {
    const entry = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const ip = typeof entry.ipv4 === 'string' ? entry.ipv4 : '';
    if (!ip) continue;
    const host = typeof entry.host === 'string' ? entry.host : key.replace(/\.local\.?$/, '');
    out.push({ hostname: host, ip });
  }
  return out;
}
