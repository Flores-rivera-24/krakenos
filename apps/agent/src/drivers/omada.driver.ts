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
  buildWlanPatch,
  parseOmadaAccessPoints,
  parseOmadaClients,
  parseOmadaTraffic,
  parseOmadaWlans,
  parseSites,
  pickData,
} from './omada.parsers.js';
import type { OmadaClient } from './omada.transport.js';

/** Id del access point lógico que agrupa las WLANs (el controller). */
const AP_ID = 'omada';

export interface OmadaDriverOptions {
  client: OmadaClient;
  /** Nombre del site (por defecto `Default`). */
  siteName?: string;
  /** `omadacId` del controller; si falta, se autodetecta vía `/api/info`. */
  omadacId?: string;
  /** Host del controller, solo para mostrar. */
  host?: string;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

interface Context {
  omadacId: string;
  siteId: string;
}

/**
 * Driver real para **TP-Link Omada Controller** (software u OC200/OC300) vía su
 * API local, sobre un `OmadaClient` inyectable. Resuelve el `omadacId` (de config
 * o `/api/info`) y el `siteId` (del nombre de site) una sola vez y los cachea.
 * Implementa inventario (clientes activos + históricos), bloqueo (cmd de cliente),
 * tráfico (overviewDashboard) y gestión de WLANs/AP. La lógica de parseo es pura
 * (`omada.parsers`); aquí solo se orquesta.
 */
export class OmadaDriver implements HardwareDriver {
  readonly kind = 'omada' as const;
  private readonly siteName: string;
  private readonly now: () => number;
  private context: Context | null = null;

  constructor(private readonly opts: OmadaDriverOptions) {
    this.siteName = opts.siteName ?? 'Default';
    this.now = opts.now ?? Date.now;
  }

  /** Resuelve y cachea `{ omadacId, siteId }` (autodetección incluida). */
  private async ctx(): Promise<Context> {
    if (this.context) return this.context;
    let omadacId = this.opts.omadacId;
    if (!omadacId) {
      const info = (await this.opts.client.get('/api/info')) as { omadacId?: string } | null;
      omadacId = info?.omadacId;
      if (!omadacId) throw new Error('No se pudo autodetectar el omadacId (GET /api/info)');
    }
    const sites = parseSites(await this.opts.client.get(`/api/v2/${omadacId}/users/current`));
    const site = sites.find((s) => s.name === this.siteName) ?? sites[0];
    if (!site) throw new Error(`No se encontró el site Omada: ${this.siteName}`);
    this.context = { omadacId, siteId: site.id };
    return this.context;
  }

  /** Prefijo `/api/v2/<omadacId>` (endpoints fuera de site). */
  private async cBase(path: string): Promise<string> {
    const { omadacId } = await this.ctx();
    return `/api/v2/${omadacId}${path}`;
  }

  /** Prefijo `/api/v2/<omadacId>/sites/<siteId>` (endpoints de site). */
  private async sBase(path: string): Promise<string> {
    const { omadacId, siteId } = await this.ctx();
    return `/api/v2/${omadacId}/sites/${siteId}${path}`;
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.ctx();
      return true;
    } catch {
      return false;
    }
  }

  async scanArp(): Promise<DiscoveredDevice[]> {
    const { siteId } = await this.ctx();
    const path = await this.cBase(`/clients?siteId=${siteId}&filters.active=true`);
    return parseOmadaClients(await this.opts.client.get(path), 'arp');
  }

  async scanMdns(): Promise<DiscoveredDevice[]> {
    try {
      const { siteId } = await this.ctx();
      const path = await this.cBase(`/clients?siteId=${siteId}&filters.active=false`);
      return parseOmadaClients(await this.opts.client.get(path), 'mdns');
    } catch {
      return [];
    }
  }

  async getTrafficSample(): Promise<TrafficSampleResult> {
    const rates = parseOmadaTraffic(await this.opts.client.get(await this.sBase('/dashboard/overviewDashboard')));
    return {
      // Omada reporta tasas (bytes/seg), no contadores: sin delta propio.
      wan: { rxBytesPerSec: rates.rxBytesPerSec, txBytesPerSec: rates.txBytesPerSec },
      devices: [], // este driver no reporta tráfico por dispositivo
    };
  }

  async blockDevice(mac: string): Promise<void> {
    await this.opts.client.post(await this.sBase('/cmd/clients/block'), { mac: mac.toLowerCase() });
  }

  async unblockDevice(mac: string): Promise<void> {
    try {
      await this.opts.client.post(await this.sBase('/cmd/clients/unblock'), { mac: mac.toLowerCase() });
    } catch {
      // Best-effort: si no estaba bloqueado, no es un error.
    }
  }

  // ---- WiFi ----

  private async loadWlanRaw(): Promise<Record<string, unknown>[]> {
    return pickData(await this.opts.client.get(await this.sBase('/setting/wlans')));
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

  private async applyWlan(
    id: string,
    input: UpdateWifiRequest | UpdateWifiNetworkRequest,
  ): Promise<void> {
    const raw = await this.loadWlanRaw();
    const current = raw.find((w) => (w.id ?? w.wlanId) === id);
    if (!current) throw new Error(`WLAN no encontrada en el controller Omada: ${id}`);
    await this.opts.client.patch(await this.sBase(`/setting/wlans/${id}`), buildWlanPatch(current, input));
  }

  async getWifi(): Promise<WifiNetwork> {
    const wlans = parseOmadaWlans(await this.loadWlanRaw(), AP_ID);
    const primary = wlans.find((w) => !w.isGuest);
    if (!primary) throw new Error('No se encontró una WLAN principal en el controller Omada');
    return this.toWifiNetwork(primary);
  }

  async updateWifi(input: UpdateWifiRequest): Promise<WifiNetwork> {
    const wlans = parseOmadaWlans(await this.loadWlanRaw(), AP_ID);
    const primary = wlans.find((w) => !w.isGuest);
    if (!primary) throw new Error('No se encontró una WLAN principal en el controller Omada');
    await this.applyWlan(primary.id, input);
    return this.getWifi();
  }

  async getGuestNetwork(): Promise<GuestNetwork> {
    const wlans = parseOmadaWlans(await this.loadWlanRaw(), AP_ID);
    const guest = wlans.find((w) => w.isGuest);
    if (!guest) throw new Error('No se encontró una WLAN de invitados en el controller Omada');
    return {
      ssid: guest.ssid,
      enabled: guest.enabled,
      clientIsolation: true,
      bandwidthLimitMbps: null,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  async updateGuestNetwork(input: UpdateGuestNetworkRequest): Promise<GuestNetwork> {
    const wlans = parseOmadaWlans(await this.loadWlanRaw(), AP_ID);
    const guest = wlans.find((w) => w.isGuest);
    if (!guest) throw new Error('No se encontró una WLAN de invitados en el controller Omada');
    await this.applyWlan(guest.id, { ssid: input.ssid, password: input.password, enabled: input.enabled });
    return this.getGuestNetwork();
  }

  // ---- Multi-AP ----

  async listAccessPoints(): Promise<AccessPoint[]> {
    return parseOmadaAccessPoints(await this.opts.client.get(await this.sBase('/devices?type=ap')));
  }

  async listWifiNetworks(): Promise<WifiNetworkInfo[]> {
    return parseOmadaWlans(await this.loadWlanRaw(), AP_ID);
  }

  async getWifiNetwork(id: string): Promise<WifiNetworkInfo | null> {
    const wlans = parseOmadaWlans(await this.loadWlanRaw(), AP_ID);
    return wlans.find((w) => w.id === id) ?? null;
  }

  async updateWifiNetwork(
    id: string,
    input: UpdateWifiNetworkRequest,
  ): Promise<WifiNetworkInfo | null> {
    const wlans = parseOmadaWlans(await this.loadWlanRaw(), AP_ID);
    if (!wlans.some((w) => w.id === id)) return null;
    await this.applyWlan(id, input);
    return this.getWifiNetwork(id);
  }

  async listNetworkClients(id: string): Promise<WifiClient[] | null> {
    const wlans = parseOmadaWlans(await this.loadWlanRaw(), AP_ID);
    const wlan = wlans.find((w) => w.id === id);
    if (!wlan) return null;
    const { siteId } = await this.ctx();
    const path = await this.cBase(`/clients?siteId=${siteId}&filters.active=true`);
    const clients = pickData(await this.opts.client.get(path));
    return clients
      .filter((c) => typeof c.ssid === 'string' && c.ssid === wlan.ssid)
      .map((c) => ({
        mac: String(c.mac ?? '').toLowerCase().replace(/-/g, ':'),
        hostname: (typeof c.name === 'string' && c.name) || (typeof c.hostName === 'string' && c.hostName) || null,
        ip: typeof c.ip === 'string' ? c.ip : '',
        signalDbm: typeof c.signal === 'number' ? c.signal : 0,
      }));
  }
}
