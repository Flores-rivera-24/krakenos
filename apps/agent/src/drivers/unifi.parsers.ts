import type {
  AccessPoint,
  DiscoveredDevice,
  WifiBand,
  WifiNetworkInfo,
  WifiSecurity,
} from '@krakenos/types';

/**
 * Parsers/builders **puros** para la API local de UniFi Network. Reciben el JSON
 * crudo de la respuesta y devuelven tipos del contrato, de modo que se testean
 * con fixtures sin un controller real. La API v2 a veces devuelve el array
 * directamente y la legacy lo envuelve en `{ data: [...] }`: `pickArray` cubre
 * ambos.
 */

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;

/** Desempaqueta tanto `[...]` directo como el sobre `{ data: [...] }`. */
export function pickArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const inner = (data as { data?: unknown }).data;
    if (Array.isArray(inner)) return inner as Record<string, unknown>[];
  }
  return [];
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

/** Nombre legible de un cliente UniFi (nombre fijado > hostname > vacío). */
function clientName(entry: Record<string, unknown>): string | null {
  return str(entry.name) ?? str(entry.hostname) ?? null;
}

/**
 * Mapea la lista de clientes (`/v2/api/site/<site>/clients/active` o
 * `/stat/alluser`) a dispositivos. `source` configurable: los activos son `arp`
 * (presencia online), los históricos `mdns` (aportan hostname/vendor).
 */
export function parseUnifiClients(
  data: unknown,
  source: DiscoveredDevice['source'] = 'arp',
): DiscoveredDevice[] {
  const out: DiscoveredDevice[] = [];
  const seen = new Set<string>();
  for (const entry of pickArray(data)) {
    const mac = str(entry.mac)?.toLowerCase();
    if (!mac || !MAC_RE.test(mac) || seen.has(mac)) continue;
    const ip = str(entry.ip) ?? str(entry.last_ip) ?? str(entry.fixed_ip);
    if (!ip) continue;
    seen.add(mac);
    out.push({
      mac,
      ip,
      hostname: clientName(entry),
      vendor: str(entry.oui),
      source,
    });
  }
  return out;
}

/** Mapea la banda de radio UniFi (`ng`=2.4, `na`=5, `6e`=6) a `WifiBand`. */
export function bandFromRadio(radio: unknown): WifiBand {
  switch (str(radio)) {
    case 'na':
      return '5GHz';
    case '6e':
      return '6GHz';
    default:
      return '2.4GHz';
  }
}

/** Mapea el modo de seguridad UniFi (`wpapsk`/`wpa3`/`open`) a `WifiSecurity`. */
export function securityFromWlan(entry: Record<string, unknown>): WifiSecurity {
  const sec = str(entry.security)?.toLowerCase();
  const wpa3 = entry.wpa3_support === true || sec === 'wpa3';
  const wpa3Transition = entry.wpa3_transition === true;
  if (sec === 'open' || entry.security === 'open') return 'open';
  if (wpa3 && wpa3Transition) return 'wpa2/wpa3';
  if (wpa3) return 'wpa3';
  return 'wpa2';
}

/**
 * Mapea la configuración de WLANs (`/v2/api/site/<site>/wlanconf`) a redes por
 * AP. El `apId` se fija a `unifi` (un único controller); el `clientCount` se
 * resuelve bajo demanda y aquí va a 0.
 */
export function parseUnifiWlans(data: unknown, apId: string): WifiNetworkInfo[] {
  const out: WifiNetworkInfo[] = [];
  for (const entry of pickArray(data)) {
    const id = str(entry._id) ?? str(entry.id);
    const ssid = str(entry.name) ?? str(entry.ssid);
    if (!id || !ssid) continue;
    out.push({
      id,
      apId,
      ssid,
      band: bandFromRadio(entry.wlan_band ?? entry.radio),
      security: securityFromWlan(entry),
      enabled: entry.enabled !== false,
      hidden: entry.hide_ssid === true,
      isGuest: entry.is_guest === true,
      clientCount: 0,
    });
  }
  return out;
}

/**
 * Mapea los dispositivos de infraestructura (`/v2/api/site/<site>/stat/device`)
 * a access points. Filtra por `type === 'uap'` (UniFi Access Point).
 */
export function parseUnifiAccessPoints(data: unknown): AccessPoint[] {
  const out: AccessPoint[] = [];
  for (const entry of pickArray(data)) {
    if (str(entry.type) !== 'uap') continue;
    const id = str(entry._id) ?? str(entry.mac);
    if (!id) continue;
    out.push({
      id,
      name: str(entry.name) ?? str(entry.model) ?? id,
      model: str(entry.model),
      ip: str(entry.ip) ?? '',
      online: entry.state === 1 || entry.state === '1',
      networkCount: Array.isArray(entry.vap_table) ? entry.vap_table.length : 0,
    });
  }
  return out;
}

/** Tasas WAN (bytes/seg) leídas de `/v2/api/site/<site>/stat/health`. */
export interface UnifiWanRates {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

/**
 * Extrae las tasas WAN del subsistema `wan` de `stat/health` (`wan_rx_bytes_r` /
 * `wan_tx_bytes_r`, ya en bytes/seg). Devuelve 0/0 si no hay entrada WAN.
 */
export function parseUnifiHealth(data: unknown): UnifiWanRates {
  for (const entry of pickArray(data)) {
    if (str(entry.subsystem) !== 'wan') continue;
    return {
      rxBytesPerSec: Math.round(numLike(entry.wan_rx_bytes_r ?? entry['rx_bytes-r'])),
      txBytesPerSec: Math.round(numLike(entry.wan_tx_bytes_r ?? entry['tx_bytes-r'])),
    };
  }
  return { rxBytesPerSec: 0, txBytesPerSec: 0 };
}

/** Banda UniFi (`ng`/`na`/`6e`) para una `WifiBand`. */
export function radioFromBand(band: WifiBand): string {
  switch (band) {
    case '5GHz':
      return 'na';
    case '6GHz':
      return '6e';
    default:
      return 'ng';
  }
}

/**
 * Construye el cuerpo de un PUT a `wlanconf/<id>` con los cambios de una red.
 * Parte de la WLAN actual (`current`) para no perder campos que UniFi exige en
 * el PUT completo. La contraseña va a `x_passphrase`.
 */
export function buildWlanUpdate(
  current: Record<string, unknown>,
  input: {
    ssid?: string;
    password?: string;
    enabled?: boolean;
    hidden?: boolean;
    band?: WifiBand;
  },
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...current };
  if (input.ssid !== undefined) body.name = input.ssid;
  if (input.password !== undefined) body.x_passphrase = input.password;
  if (input.enabled !== undefined) body.enabled = input.enabled;
  if (input.hidden !== undefined) body.hide_ssid = input.hidden;
  if (input.band !== undefined) body.wlan_band = radioFromBand(input.band);
  return body;
}
