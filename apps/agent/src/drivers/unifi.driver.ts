import type {
  AccessPoint,
  DiscoveredDevice,
  GuestNetwork,
  HardwareDriver,
  TrafficSampleResult,
  UpdateGuestNetworkRequest,
  UpdateWifiNetworkRequest,
  UpdateWifiRequest,
  WifiClient,
  WifiNetwork,
  WifiNetworkInfo,
} from '@krakenos/types';
import {
  buildWlanUpdate,
  parseUnifiAccessPoints,
  parseUnifiClients,
  parseUnifiHealth,
  parseUnifiWlans,
  pickArray,
} from './unifi.parsers.js';
import type { UnifiClient } from './unifi.transport.js';

/** Id del access point lógico que agrupa las WLANs (el propio controller). */
const AP_ID = 'unifi';

export interface UnifiDriverOptions {
  client: UnifiClient;
  /** Site de UniFi (por defecto `default`). */
  site?: string;
  /** Host del controller, solo para mostrar. */
  host?: string;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

/**
 * Driver real para **Ubiquiti UniFi Network** (Dream Machine/Router, USG,
 * switches US-X) vía su API local, sobre un `UnifiClient` inyectable. Implementa
 * inventario (clientes activos + históricos), tráfico (tasas WAN de
 * `stat/health`), bloqueo (cmd de cliente) y gestión de WLANs/AP. La lógica de
 * parseo/construcción es pura (`unifi.parsers`); aquí solo se orquesta.
 *
 * Las rutas siguen la API v2 del controller; algunos endpoints varían entre
 * UniFi OS, controller self-hosted y versión de firmware (ver
 * `docs/unifi-setup.md`).
 */
export class UnifiDriver implements HardwareDriver {
  readonly kind = 'unifi' as const;
  private readonly site: string;
  private readonly now: () => number;

  constructor(private readonly opts: UnifiDriverOptions) {
    this.site = opts.site ?? 'default';
    this.now = opts.now ?? Date.now;
  }

  /** Prefijo de la API v2 para el site configurado. */
  private base(path: string): string {
    return `/v2/api/site/${this.site}${path}`;
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.opts.client.get(this.base('/stat/health'));
      return true;
    } catch {
      return false;
    }
  }

  async scanArp(): Promise<DiscoveredDevice[]> {
    // Clientes activos = presencia online ahora mismo.
    return parseUnifiClients(await this.opts.client.get(this.base('/clients/active')), 'arp');
  }

  async scanMdns(): Promise<DiscoveredDevice[]> {
    // Histórico de clientes: aporta hostname/vendor (incluye offline recientes).
    try {
      return parseUnifiClients(await this.opts.client.get(this.base('/stat/alluser')), 'mdns');
    } catch {
      return [];
    }
  }

  async getTrafficSample(): Promise<TrafficSampleResult> {
    const rates = parseUnifiHealth(await this.opts.client.get(this.base('/stat/health')));
    return {
      // UniFi ya reporta tasas (bytes/seg), no contadores: sin delta propio.
      wan: { rxBytesPerSec: rates.rxBytesPerSec, txBytesPerSec: rates.txBytesPerSec },
      devices: [], // este driver no reporta tráfico por dispositivo
    };
  }

  async blockDevice(mac: string): Promise<void> {
    await this.opts.client.post(this.base(`/clients/${mac.toLowerCase()}/block`), {});
  }

  async unblockDevice(mac: string): Promise<void> {
    try {
      await this.opts.client.post(this.base(`/clients/${mac.toLowerCase()}/unblock`), {});
    } catch {
      // Best-effort: si no estaba bloqueado, no es un error.
    }
  }

  // ---- WiFi ----

  /** Carga las WLANs crudas (para localizar ids y construir PUTs completos). */
  private async loadWlanRaw(): Promise<Record<string, unknown>[]> {
    return pickArray(await this.opts.client.get(this.base('/wlanconf')));
  }

  private toWifiNetwork(info: WifiNetworkInfo): WifiNetwork {
    return {
      ssid: info.ssid,
      enabled: info.enabled,
      band: info.band,
      security: info.security,
      hidden: info.hidden,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  async getWifi(): Promise<WifiNetwork> {
    const wlans = parseUnifiWlans(await this.loadWlanRaw(), AP_ID);
    const primary = wlans.find((w) => !w.isGuest);
    if (!primary) throw new Error('No se encontró una WLAN principal en el controller UniFi');
    return this.toWifiNetwork(primary);
  }

  /** Aplica un cambio a la WLAN identificada por `id` con un PUT completo. */
  private async applyWlan(
    id: string,
    input: UpdateWifiRequest | UpdateWifiNetworkRequest,
  ): Promise<void> {
    const raw = await this.loadWlanRaw();
    const current = raw.find((w) => (w._id ?? w.id) === id);
    if (!current) throw new Error(`WLAN no encontrada en el controller UniFi: ${id}`);
    await this.opts.client.put(this.base(`/wlanconf/${id}`), buildWlanUpdate(current, input));
  }

  async updateWifi(input: UpdateWifiRequest): Promise<WifiNetwork> {
    const wlans = parseUnifiWlans(await this.loadWlanRaw(), AP_ID);
    const primary = wlans.find((w) => !w.isGuest);
    if (!primary) throw new Error('No se encontró una WLAN principal en el controller UniFi');
    await this.applyWlan(primary.id, input);
    return this.getWifi();
  }

  async getGuestNetwork(): Promise<GuestNetwork> {
    const wlans = parseUnifiWlans(await this.loadWlanRaw(), AP_ID);
    const guest = wlans.find((w) => w.isGuest);
    if (!guest) throw new Error('No se encontró una WLAN de invitados en el controller UniFi');
    return {
      ssid: guest.ssid,
      enabled: guest.enabled,
      // UniFi aísla a los invitados con el portal de invitados; no se modela aquí.
      clientIsolation: true,
      bandwidthLimitMbps: null,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  async updateGuestNetwork(input: UpdateGuestNetworkRequest): Promise<GuestNetwork> {
    const wlans = parseUnifiWlans(await this.loadWlanRaw(), AP_ID);
    const guest = wlans.find((w) => w.isGuest);
    if (!guest) throw new Error('No se encontró una WLAN de invitados en el controller UniFi');
    await this.applyWlan(guest.id, { ssid: input.ssid, password: input.password, enabled: input.enabled });
    return this.getGuestNetwork();
  }

  // ---- Multi-AP ----

  async listAccessPoints(): Promise<AccessPoint[]> {
    return parseUnifiAccessPoints(await this.opts.client.get(this.base('/stat/device')));
  }

  async listWifiNetworks(): Promise<WifiNetworkInfo[]> {
    return parseUnifiWlans(await this.loadWlanRaw(), AP_ID);
  }

  async getWifiNetwork(id: string): Promise<WifiNetworkInfo | null> {
    const wlans = parseUnifiWlans(await this.loadWlanRaw(), AP_ID);
    return wlans.find((w) => w.id === id) ?? null;
  }

  async updateWifiNetwork(
    id: string,
    input: UpdateWifiNetworkRequest,
  ): Promise<WifiNetworkInfo | null> {
    const wlans = parseUnifiWlans(await this.loadWlanRaw(), AP_ID);
    if (!wlans.some((w) => w.id === id)) return null;
    await this.applyWlan(id, input);
    return this.getWifiNetwork(id);
  }

  async listNetworkClients(id: string): Promise<WifiClient[] | null> {
    const wlans = parseUnifiWlans(await this.loadWlanRaw(), AP_ID);
    const wlan = wlans.find((w) => w.id === id);
    if (!wlan) return null;
    const clients = pickArray(await this.opts.client.get(this.base('/clients/active')));
    return clients
      .filter((c) => typeof c.essid === 'string' && c.essid === wlan.ssid)
      .map((c) => ({
        mac: String(c.mac ?? '').toLowerCase(),
        hostname: (typeof c.name === 'string' && c.name) || (typeof c.hostname === 'string' && c.hostname) || null,
        ip: typeof c.ip === 'string' ? c.ip : '',
        signalDbm: typeof c.signal === 'number' ? c.signal : 0,
      }));
  }
}
