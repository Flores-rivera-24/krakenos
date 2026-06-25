import type {
  AccessPoint,
  GuestNetwork,
  WifiBand,
  WifiClient,
  WifiNetwork,
  WifiNetworkInfo,
  WifiSecurity,
} from '@krakenos/types';
import { DriverUnavailableError } from '../../drivers/driver-error.js';

/**
 * Endurece la **frontera del driver** para las respuestas WiFi (US-98). A
 * diferencia del inventario (donde se puede degradar a una lista vacía), la red
 * principal/invitados son objetos únicos: si el driver devuelve una forma
 * inutilizable (`null`, campos ausentes/del tipo equivocado) no hay nada
 * sensato que inventar, así que se lanza `DriverUnavailableError` → **502**
 * tipado, coherente con un fallo del hardware aguas arriba. Las **listas**
 * (APs, redes, clientes) descartan entrada a entrada las inválidas; un valor
 * que ni siquiera es un array sí se considera fallo del driver (502).
 */

const BANDS: ReadonlySet<string> = new Set<WifiBand>(['2.4GHz', '5GHz', '6GHz']);
const SECURITIES: ReadonlySet<string> = new Set<WifiSecurity>(['open', 'wpa2', 'wpa3', 'wpa2/wpa3']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function isString(v: unknown): v is string {
  return typeof v === 'string';
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function normalizeWifiNetwork(raw: unknown, method = 'getWifi'): WifiNetwork {
  if (!isObject(raw)) throw new DriverUnavailableError(`${method} (respuesta no es un objeto)`);
  const { ssid, enabled, band, security, hidden, updatedAt } = raw;
  if (
    !isString(ssid) ||
    !isBoolean(enabled) ||
    !isString(band) ||
    !BANDS.has(band) ||
    !isString(security) ||
    !SECURITIES.has(security) ||
    !isBoolean(hidden) ||
    !isString(updatedAt)
  ) {
    throw new DriverUnavailableError(`${method} (campos inválidos)`);
  }
  return {
    ssid,
    enabled,
    band: band as WifiBand,
    security: security as WifiSecurity,
    hidden,
    updatedAt,
  };
}

export function normalizeGuestNetwork(raw: unknown, method = 'getGuestNetwork'): GuestNetwork {
  if (!isObject(raw)) throw new DriverUnavailableError(`${method} (respuesta no es un objeto)`);
  const { ssid, enabled, clientIsolation, bandwidthLimitMbps, updatedAt } = raw;
  if (
    !isString(ssid) ||
    !isBoolean(enabled) ||
    !isBoolean(clientIsolation) ||
    !(bandwidthLimitMbps === null || isFiniteNumber(bandwidthLimitMbps)) ||
    !isString(updatedAt)
  ) {
    throw new DriverUnavailableError(`${method} (campos inválidos)`);
  }
  return { ssid, enabled, clientIsolation, bandwidthLimitMbps, updatedAt };
}

export function normalizeAccessPoints(raw: unknown): AccessPoint[] {
  if (!Array.isArray(raw)) throw new DriverUnavailableError('listAccessPoints (no es un array)');
  return raw.map(toAccessPoint).filter((ap): ap is AccessPoint => ap !== null);
}

function toAccessPoint(entry: unknown): AccessPoint | null {
  if (!isObject(entry)) return null;
  const { id, name, model, ip, online, networkCount } = entry;
  if (!isString(id) || !isString(name) || !isString(ip) || !isBoolean(online)) return null;
  if (!isFiniteNumber(networkCount)) return null;
  return { id, name, model: isString(model) ? model : null, ip, online, networkCount };
}

export function normalizeWifiNetworks(raw: unknown): WifiNetworkInfo[] {
  if (!Array.isArray(raw)) throw new DriverUnavailableError('listWifiNetworks (no es un array)');
  return raw.map(toWifiNetworkInfo).filter((n): n is WifiNetworkInfo => n !== null);
}

/** Para getWifiNetwork/updateWifiNetwork: `null` (no existe) pasa; un objeto se valida. */
export function normalizeWifiNetworkOrNull(
  raw: unknown,
  method = 'getWifiNetwork',
): WifiNetworkInfo | null {
  if (raw === null || raw === undefined) return null;
  const info = toWifiNetworkInfo(raw);
  if (!info) throw new DriverUnavailableError(`${method} (campos inválidos)`);
  return info;
}

function toWifiNetworkInfo(entry: unknown): WifiNetworkInfo | null {
  if (!isObject(entry)) return null;
  const { id, apId, ssid, band, security, enabled, hidden, isGuest, clientCount } = entry;
  if (!isString(id) || !isString(apId) || !isString(ssid)) return null;
  if (!isString(band) || !BANDS.has(band) || !isString(security) || !SECURITIES.has(security)) {
    return null;
  }
  if (!isBoolean(enabled) || !isBoolean(hidden) || !isBoolean(isGuest)) return null;
  if (!isFiniteNumber(clientCount)) return null;
  return {
    id,
    apId,
    ssid,
    band: band as WifiBand,
    security: security as WifiSecurity,
    enabled,
    hidden,
    isGuest,
    clientCount,
  };
}

/** Para listNetworkClients: `null` (la red no existe) pasa; un array se sanea. */
export function normalizeWifiClientsOrNull(raw: unknown): WifiClient[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) throw new DriverUnavailableError('listNetworkClients (no es un array)');
  return raw.map(toWifiClient).filter((c): c is WifiClient => c !== null);
}

function toWifiClient(entry: unknown): WifiClient | null {
  if (!isObject(entry)) return null;
  const { mac, hostname, ip, signalDbm } = entry;
  if (!isString(mac) || mac.length === 0 || !isString(ip)) return null;
  if (!isFiniteNumber(signalDbm)) return null;
  return { mac, hostname: isString(hostname) ? hostname : null, ip, signalDbm };
}
