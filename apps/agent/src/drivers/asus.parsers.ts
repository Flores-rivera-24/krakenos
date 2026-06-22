import type { DiscoveredDevice, WifiSecurity } from '@krakenos/types';

/**
 * Parsers/builders **puros** para routers **ASUS / Asuswrt-Merlin** vía
 * `appGet.cgi`. Las respuestas de ASUS son JSON-ish (a veces con claves sin
 * comillas o pares `clave=valor`): estos helpers normalizan ambos formatos y
 * devuelven tipos del contrato, de modo que se testean con fixtures sin un router
 * real.
 */

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Convierte `0x1a2b`/decimal/string a número (contadores de tráfico ASUS). */
function counter(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = value.startsWith('0x') ? Number.parseInt(value, 16) : Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Intenta `JSON.parse`; si falla, devuelve `null` (respuesta no-JSON). */
function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Parsea una respuesta nvram (`nvram_get(...)`) a un mapa `clave→valor`. Acepta
 * el JSON de ASUS (`{"wl0_ssid":"x"}`) y el formato de líneas `clave=valor` /
 * `clave: "valor"` de algunas builds.
 */
export function parseNvram(text: string): Record<string, string> {
  const json = tryJson(text);
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
    }
    return out;
  }
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*[=:]\s*"?([^"\n]*?)"?\s*,?\s*$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/**
 * Parsea `get_clientlist()` a dispositivos. Navega `get_clientlist.maclist` y
 * lee cada entrada (ip, name/nickName, vendor, isOnline). Solo devuelve los
 * **online** (los offline marcarían presencia falsa en el inventario).
 */
export function parseClientList(text: string): DiscoveredDevice[] {
  const root = tryJson(text);
  const list = (root as { get_clientlist?: Record<string, unknown> } | null)?.get_clientlist;
  if (!list || typeof list !== 'object') return [];
  const macs = Array.isArray(list.maclist) ? (list.maclist as unknown[]) : Object.keys(list);
  const out: DiscoveredDevice[] = [];
  const seen = new Set<string>();
  for (const rawMac of macs) {
    if (typeof rawMac !== 'string' || rawMac === 'maclist') continue;
    const entry = list[rawMac] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== 'object') continue;
    const mac = (str(entry.mac) ?? rawMac).toLowerCase();
    if (!MAC_RE.test(mac) || seen.has(mac)) continue;
    if (String(entry.isOnline ?? '0') !== '1') continue;
    const ip = str(entry.ip);
    if (!ip) continue;
    seen.add(mac);
    out.push({
      mac,
      ip,
      hostname: str(entry.nickName) ?? str(entry.name),
      vendor: str(entry.vendor),
      source: 'arp',
    });
  }
  return out;
}

/** Contadores rx/tx (bytes acumulados) de la WAN. */
export interface IfaceCounters {
  rxBytes: number;
  txBytes: number;
}

/**
 * Parsea `get_traffics()`/`netdev(...)` y extrae los contadores de la WAN.
 * Busca la entrada `INTERNET`/`WAN`/`wan` y lee `rx`/`tx` (alias `recv`/`sent`).
 */
export function parseTraffics(text: string): IfaceCounters | null {
  const root = tryJson(text);
  if (!root || typeof root !== 'object') return null;
  const obj = root as Record<string, unknown>;
  const container = (obj.netdev ?? obj) as Record<string, unknown>;
  const wanKey = Object.keys(container).find((k) => /^(internet|wan)$/i.test(k));
  const entry = (wanKey ? container[wanKey] : null) as Record<string, unknown> | null;
  if (!entry || typeof entry !== 'object') return null;
  return {
    rxBytes: counter(entry.rx ?? entry.recv),
    txBytes: counter(entry.tx ?? entry.sent),
  };
}

/** Mapea el `auth_mode_x` de ASUS (`open`/`psk2`/`sae`/`psk2sae`) a `WifiSecurity`. */
export function securityFromAuthMode(mode: string | undefined): WifiSecurity {
  switch ((mode ?? '').toLowerCase()) {
    case 'open':
    case 'openowe':
      return 'open';
    case 'sae':
      return 'wpa3';
    case 'psk2sae':
      return 'wpa2/wpa3';
    default:
      return 'wpa2';
  }
}

/** Prefijo nvram de una banda: `wl0` (2.4GHz) o `wl1` (5GHz). */
export function bandPrefix(band: '2.4GHz' | '5GHz'): string {
  return band === '5GHz' ? 'wl1' : 'wl0';
}

/**
 * Construye el nuevo valor de `MULTIFILTER_MAC` (lista separada por `&#62;`/`>` o
 * `<`) añadiendo o quitando una MAC. ASUS usa `>` como separador en el filtro MAC.
 */
export function buildMacFilter(current: string, mac: string, action: 'add' | 'remove'): string {
  const m = mac.toLowerCase();
  const macs = current
    .split('>')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const has = macs.includes(m);
  let next: string[];
  if (action === 'add') next = has ? macs : [...macs, m];
  else next = macs.filter((x) => x !== m);
  return next.join('>');
}
