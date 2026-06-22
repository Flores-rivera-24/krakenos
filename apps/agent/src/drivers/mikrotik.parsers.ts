import type { DiscoveredDevice, WifiBand, WifiNetworkInfo } from '@krakenos/types';

/**
 * Parsers/builders **puros** para RouterOS (MikroTik), compartidos por los dos
 * modos de transporte (REST y SSH+CLI). Reciben filas ya normalizadas a
 * `Record<string, unknown>` (la REST devuelve JSON; el modo SSH convierte el
 * `print terse` a filas con `parseTerse`) y devuelven tipos del contrato, de modo
 * que se testean con fixtures sin un router real.
 */

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

/** Lista de address-list que KrakenOS usa para bloquear dispositivos. */
export const BLOCK_LIST = 'krakenos-blocked';

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numLike(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/\s+/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Comentario con el que se etiqueta la entrada de bloqueo (para localizarla). */
export function blockComment(mac: string): string {
  return `krakenos-block:${mac.toLowerCase()}`;
}

/**
 * Parsea la salida `print terse` de RouterOS (modo SSH) a filas. Cada línea es
 * `0 D address=1.2.3.4 mac-address=AA:BB ...`; se ignoran el índice y las flags
 * iniciales y se extraen los pares `clave=valor` (los valores con espacios van
 * entre comillas).
 */
export function parseTerse(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const row: Record<string, string> = {};
    const re = /([\w-]+)=("([^"]*)"|(\S+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      row[m[1]!] = m[3] ?? m[4] ?? '';
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

/**
 * Mapea las entradas de `/ip/arp` a dispositivos. Cada fila trae `address` (IP) y
 * `mac-address`. Se descartan las incompletas y se deduplica por MAC.
 */
export function parseMikrotikArp(rows: Record<string, unknown>[]): DiscoveredDevice[] {
  const out: DiscoveredDevice[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const mac = str(row['mac-address'])?.toLowerCase();
    const ip = str(row.address);
    if (!mac || !ip || !MAC_RE.test(mac) || seen.has(mac)) continue;
    seen.add(mac);
    out.push({ mac, ip, source: 'arp' });
  }
  return out;
}

/**
 * Mapea las concesiones de `/ip/dhcp-server/lease` a dispositivos con hostname
 * (fuente de nombres en RouterOS). Source `mdns` para encajar en el pipeline de
 * enriquecimiento del inventario.
 */
export function parseMikrotikLeases(rows: Record<string, unknown>[]): DiscoveredDevice[] {
  const out: DiscoveredDevice[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const mac = str(row['mac-address'])?.toLowerCase();
    const ip = str(row.address) ?? str(row['active-address']);
    const hostname = str(row['host-name']) ?? str(row.comment);
    if (!mac || !ip || !hostname || !MAC_RE.test(mac) || seen.has(mac)) continue;
    seen.add(mac);
    out.push({ mac, ip, hostname, source: 'mdns' });
  }
  return out;
}

/** Contadores rx/tx (bytes acumulados) de una interfaz. */
export interface IfaceCounters {
  rxBytes: number;
  txBytes: number;
}

/**
 * Extrae los contadores `rx-byte`/`tx-byte` de la interfaz WAN de
 * `/rest/interface` (empareja por `name`). Devuelve `null` si no existe.
 */
export function parseMikrotikInterface(
  rows: Record<string, unknown>[],
  wan: string,
): IfaceCounters | null {
  for (const row of rows) {
    if (str(row.name) !== wan) continue;
    return { rxBytes: numLike(row['rx-byte']), txBytes: numLike(row['tx-byte']) };
  }
  return null;
}

/** Busca el `address` (IP) asociado a una `mac` en filas de ARP. */
export function ipForMac(rows: Record<string, unknown>[], mac: string): string | null {
  const m = mac.toLowerCase();
  for (const row of rows) {
    if (str(row['mac-address'])?.toLowerCase() === m) return str(row.address);
  }
  return null;
}

/**
 * Busca el `.id` de la entrada de address-list que bloquea a `mac` (por
 * comentario) o, en su defecto, por IP. `null` si no hay ninguna.
 */
export function blockEntryId(
  rows: Record<string, unknown>[],
  mac: string,
  ip: string | null,
): string | null {
  const comment = blockComment(mac);
  for (const row of rows) {
    if (str(row.list) !== BLOCK_LIST) continue;
    if (str(row.comment) === comment || (ip && str(row.address) === ip)) {
      return str(row['.id']) ?? str(row.id);
    }
  }
  return null;
}

/** Mapea la banda RouterOS (`2ghz-*`, `5ghz-*`, `6ghz-*`) a `WifiBand`. */
export function bandFromMikrotik(band: unknown): WifiBand {
  const b = str(band)?.toLowerCase() ?? '';
  if (b.startsWith('5ghz')) return '5GHz';
  if (b.startsWith('6ghz')) return '6GHz';
  return '2.4GHz';
}

/**
 * Mapea las interfaces de `/interface/wireless` a redes WiFi. Cada interfaz es
 * una red; el `apId` se fija al id del router (un único AP). La seguridad real
 * vive en `security-profile` (menú aparte): baseline `wpa2`.
 */
export function parseMikrotikWireless(
  rows: Record<string, unknown>[],
  apId: string,
): WifiNetworkInfo[] {
  const out: WifiNetworkInfo[] = [];
  for (const row of rows) {
    const id = str(row['.id']) ?? str(row.id) ?? str(row.name);
    const ssid = str(row.ssid);
    if (!id || !ssid) continue;
    out.push({
      id,
      apId,
      ssid,
      band: bandFromMikrotik(row.band),
      security: 'wpa2',
      enabled: row.disabled !== 'true' && row.disabled !== true,
      hidden: row['hide-ssid'] === 'true' || row['hide-ssid'] === true,
      isGuest: false,
      clientCount: 0,
    });
  }
  return out;
}
