import type { DiscoveredDevice } from '@krakenos/types';

/**
 * Parsers **puros** de la salida del CLI de Cisco IOS/IOS-XE a estructuras
 * tipadas. Reciben el texto ya capturado y no tocan la red, de modo que se
 * testean con fixtures representativas sin un switch real.
 *
 * Nota MAC: IOS usa el formato `xxxx.xxxx.xxxx`; todos los parsers normalizan a
 * `xx:xx:xx:xx:xx:xx` (minúsculas) vía {@link normalizeCiscoMac}.
 */

/** Convierte cualquier MAC (Cisco `xxxx.xxxx.xxxx` o estándar) a `xx:xx:xx:xx:xx:xx`. */
export function normalizeCiscoMac(mac: string): string {
  const hex = mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12) throw new Error(`MAC Cisco inválida: ${mac}`);
  return (hex.match(/.{2}/g) as string[]).join(':');
}

/** `true` si la cadena tiene forma de MAC Cisco (`xxxx.xxxx.xxxx`). */
function isCiscoMac(token: string): boolean {
  return /^[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}$/.test(token);
}

export interface ArpEntry {
  ip: string;
  mac: string;
  interface: string;
}

/**
 * Parsea `show arp`. Formato típico:
 * `Internet  192.168.1.10   12   aabb.ccdd.eeff  ARPA  GigabitEthernet0/1`.
 * Ignora entradas incompletas o sin MAC resuelta (`Incomplete`).
 */
export function parseArp(output: string): ArpEntry[] {
  const out: ArpEntry[] = [];
  for (const line of output.split('\n')) {
    const cols = line.trim().split(/\s+/);
    // Protocol Address Age Hardware Type Interface
    if (cols.length < 6 || cols[0] !== 'Internet') continue;
    const [, ip, , hw, , iface] = cols as [string, string, string, string, string, string];
    if (!isCiscoMac(hw)) continue;
    out.push({ ip, mac: normalizeCiscoMac(hw), interface: iface });
  }
  return out;
}

export interface MacTableEntry {
  vlan: string;
  mac: string;
  type: string;
  ports: string;
}

/**
 * Parsea `show mac address-table`. Líneas de datos:
 * `   1    0011.2233.4455    DYNAMIC     Gi0/1`. Salta cabeceras/separadores y
 * entradas multicast (`CPU`/sin VLAN numérica).
 */
export function parseMacTable(output: string): MacTableEntry[] {
  const out: MacTableEntry[] = [];
  for (const line of output.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const [vlan, mac, type, ports] = cols as [string, string, string, string];
    if (!/^\d+$/.test(vlan) || !isCiscoMac(mac)) continue;
    out.push({ vlan, mac: normalizeCiscoMac(mac), type: type.toUpperCase(), ports });
  }
  return out;
}

export interface InterfaceCounters {
  rxBytes: number;
  txBytes: number;
}

/**
 * Extrae los contadores rx/tx de `show interfaces <iface>`:
 * `123 packets input, 789012345 bytes` y `234 packets output, 456789012 bytes`.
 * Devuelve `{0,0}` si no se encuentran (interfaz sin tráfico aún).
 */
export function parseInterfaces(output: string): InterfaceCounters {
  const rx = output.match(/packets input,\s*(\d+)\s*bytes/i);
  const tx = output.match(/packets output,\s*(\d+)\s*bytes/i);
  return {
    rxBytes: rx ? Number(rx[1]) : 0,
    txBytes: tx ? Number(tx[1]) : 0,
  };
}

export interface VersionInfo {
  model: string;
  iosVersion: string;
  uptime: string;
}

/** Parsea `show version` (modelo, versión IOS y uptime). Campos faltantes → ''. */
export function parseVersion(output: string): VersionInfo {
  const version = output.match(/Version\s+([^\s,]+)/i);
  // Línea `cisco WS-C2960-24TT-L (PowerPC405) processor ...` (requiere "processor"
  // para no confundirla con la cabecera `Cisco IOS Software, ...`).
  const model = output.match(/^cisco\s+(\S+)[^\n]*processor/im);
  const uptime = output.match(/uptime is\s+(.+)/i);
  return {
    model: model?.[1]?.trim() ?? '',
    iosVersion: version?.[1]?.trim() ?? '',
    uptime: uptime?.[1]?.trim() ?? '',
  };
}

export interface VlanEntry {
  id: number;
  name: string;
  status: string;
}

/**
 * Parsea `show vlan brief`. Líneas de datos:
 * `10   Servers   active   Gi0/3`. Salta cabecera/separadores.
 */
export function parseVlan(output: string): VlanEntry[] {
  const out: VlanEntry[] = [];
  for (const line of output.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 3) continue;
    const [id, name, status] = cols as [string, string, string];
    if (!/^\d+$/.test(id)) continue;
    out.push({ id: Number(id), name, status });
  }
  return out;
}

/** Convierte entradas ARP a dispositivos descubiertos del contrato. */
export function arpToDevices(entries: ArpEntry[]): DiscoveredDevice[] {
  const seen = new Set<string>();
  const out: DiscoveredDevice[] = [];
  for (const e of entries) {
    if (seen.has(e.mac)) continue;
    seen.add(e.mac);
    out.push({ mac: e.mac, ip: e.ip, source: 'arp' });
  }
  return out;
}
