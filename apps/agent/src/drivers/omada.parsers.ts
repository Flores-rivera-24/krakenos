import type {
  AccessPoint,
  DiscoveredDevice,
  WifiBand,
  WifiNetworkInfo,
  WifiSecurity,
} from '@krakenos/types';

/**
 * Parsers/builders **puros** para la API del controller TP-Link Omada. Reciben el
 * `result` ya desempaquetado del sobre y devuelven tipos del contrato, de modo
 * que se testean con fixtures sin un controller real. Las listas de Omada vienen
 * como `{ data: [...], totalRows }`: `pickData` cubre eso y el array directo.
 */

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

/** Normaliza la MAC de Omada (que usa `-` como separador y mayúsculas). */
function normalizeMac(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const mac = value.toLowerCase().replace(/-/g, ':');
  return MAC_RE.test(mac) ? mac : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numLike(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Desempaqueta tanto `[...]` directo como `{ data: [...] }` (listas Omada). */
export function pickData(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object') {
    const inner = (result as { data?: unknown }).data;
    if (Array.isArray(inner)) return inner as Record<string, unknown>[];
  }
  return [];
}

/**
 * Mapea la lista de clientes (`/clients?filters.active=…`) a dispositivos. La MAC
 * de Omada usa `-`; se normaliza a `:`. `source` configurable (activos → `arp`,
 * históricos → `mdns`).
 */
export function parseOmadaClients(
  result: unknown,
  source: DiscoveredDevice['source'] = 'arp',
): DiscoveredDevice[] {
  const out: DiscoveredDevice[] = [];
  const seen = new Set<string>();
  for (const entry of pickData(result)) {
    const mac = normalizeMac(entry.mac);
    if (!mac || seen.has(mac)) continue;
    const ip = str(entry.ip) ?? str(entry.ipAddr);
    if (!ip) continue;
    seen.add(mac);
    out.push({
      mac,
      ip,
      hostname: str(entry.name) ?? str(entry.hostName),
      vendor: str(entry.vendor) ?? str(entry.manufacturer),
      source,
    });
  }
  return out;
}

/**
 * Mapea los dispositivos de infraestructura (`/devices?type=ap`) a access points.
 * En Omada `status` 0 = desconectado; cualquier otro valor = conectado.
 */
export function parseOmadaAccessPoints(result: unknown): AccessPoint[] {
  const out: AccessPoint[] = [];
  for (const entry of pickData(result)) {
    const mac = normalizeMac(entry.mac);
    const id = str(entry.mac) ? mac : str(entry.id);
    if (!id) continue;
    out.push({
      id,
      name: str(entry.name) ?? str(entry.model) ?? id,
      model: str(entry.model),
      ip: str(entry.ip) ?? '',
      online: numLike(entry.status) !== 0,
      networkCount: numLike(entry.clientNum),
    });
  }
  return out;
}

/** Mapea la banda Omada (`wlanBand` 0=2.4, 1=5, 2=6 / cadenas) a `WifiBand`. */
export function bandFromOmada(value: unknown): WifiBand {
  const v = str(value)?.toLowerCase() ?? '';
  if (v.includes('6')) return '6GHz';
  if (v.includes('5')) return '5GHz';
  if (numLike(value) === 2) return '6GHz';
  if (numLike(value) === 1) return '5GHz';
  return '2.4GHz';
}

/** Mapea el modo de seguridad Omada (`security` 0=open,3=wpa-psk,…) a `WifiSecurity`. */
export function securityFromOmada(entry: Record<string, unknown>): WifiSecurity {
  const sec = numLike(entry.security);
  if (sec === 0) return 'open';
  if (entry.wpaMode === 3 || entry.versions === 'wpa3') return 'wpa3';
  return 'wpa2';
}

/** Mapea las WLANs (`/setting/wlans`) a redes WiFi. */
export function parseOmadaWlans(result: unknown, apId: string): WifiNetworkInfo[] {
  const out: WifiNetworkInfo[] = [];
  for (const entry of pickData(result)) {
    const id = str(entry.id) ?? str(entry.wlanId);
    const ssid = str(entry.name) ?? str(entry.ssid);
    if (!id || !ssid) continue;
    out.push({
      id,
      apId,
      ssid,
      band: bandFromOmada(entry.wlanBand ?? entry.band),
      security: securityFromOmada(entry),
      enabled: entry.enable !== false && entry.wlanScheduleEnable !== false,
      hidden: entry.broadcast === false || entry.hideSsid === true,
      isGuest: entry.guestNetEnable === true || entry.isGuest === true,
      clientCount: 0,
    });
  }
  return out;
}

/** Tasas WAN (bytes/seg) leídas de `/dashboard/overviewDashboard`. */
export interface OmadaWanRates {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

/**
 * Extrae las tasas WAN de `overviewDashboard` (`wanDownload`/`wanUpload`, en
 * bytes/seg). Devuelve 0/0 si no están.
 */
export function parseOmadaTraffic(result: unknown): OmadaWanRates {
  const r = (result ?? {}) as Record<string, unknown>;
  return {
    rxBytesPerSec: Math.round(numLike(r.wanDownload ?? r.wanRxRate)),
    txBytesPerSec: Math.round(numLike(r.wanUpload ?? r.wanTxRate)),
  };
}

/** Banda Omada (0/1/2) para una `WifiBand`. */
export function omadaBandValue(band: WifiBand): number {
  switch (band) {
    case '5GHz':
      return 1;
    case '6GHz':
      return 2;
    default:
      return 0;
  }
}

/**
 * Construye el cuerpo del PATCH a `setting/wlans/<id>` con los cambios de una
 * red. Parte de la WLAN actual para no perder campos. La contraseña va a
 * `psk`/`wpaPsk`.
 */
export function buildWlanPatch(
  current: Record<string, unknown>,
  input: { ssid?: string; password?: string; enabled?: boolean; hidden?: boolean; band?: WifiBand },
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...current };
  if (input.ssid !== undefined) body.name = input.ssid;
  if (input.password !== undefined) body.psk = input.password;
  if (input.enabled !== undefined) body.enable = input.enabled;
  if (input.hidden !== undefined) body.broadcast = !input.hidden;
  if (input.band !== undefined) body.wlanBand = omadaBandValue(input.band);
  return body;
}

/**
 * Mapea las "sites" del usuario actual (`/users/current` → `privilege.sites`) a
 * pares {name, id}. Sirve para resolver el `siteId` desde el nombre configurado.
 */
export function parseSites(result: unknown): { name: string; id: string }[] {
  const priv = (result as { privilege?: { sites?: unknown } } | null)?.privilege;
  const sites = Array.isArray(priv?.sites) ? (priv!.sites as Record<string, unknown>[]) : [];
  const out: { name: string; id: string }[] = [];
  for (const s of sites) {
    const name = str(s.name);
    const id = str(s.key) ?? str(s.id);
    if (name && id) out.push({ name, id });
  }
  return out;
}
