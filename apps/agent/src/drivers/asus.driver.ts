import type {
  AccessPoint,
  DiscoveredDevice,
  GuestNetwork,
  HardwareDriver,
  TrafficSampleResult,
  UpdateGuestNetworkRequest,
  UpdateWifiNetworkRequest,
  UpdateWifiRequest,
  WifiBand,
  WifiClient,
  WifiNetwork,
  WifiNetworkInfo,
} from '@krakenos/types';
import {
  type IfaceCounters,
  buildMacFilter,
  parseClientList,
  parseNvram,
  parseTraffics,
  securityFromAuthMode,
} from './asus.parsers.js';
import type { AsusClient } from './asus.transport.js';

/** Único access point modelado: el propio router ASUS. */
const AP_ID = 'asus';
/** Bandas modeladas (wl0 = 2.4GHz, wl1 = 5GHz). */
const BANDS: { id: string; band: WifiBand; prefix: string }[] = [
  { id: 'wl0', band: '2.4GHz', prefix: 'wl0' },
  { id: 'wl1', band: '5GHz', prefix: 'wl1' },
];

export interface AsusDriverOptions {
  client: AsusClient;
  /** Host del router, solo para mostrar en el access point. */
  host?: string;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

interface Counters extends IfaceCounters {
  t: number;
}

/** ASUS no expone una red de invitados estándar por este camino (baseline). */
function guestUnsupported(): never {
  throw new Error(
    'Red de invitados no gestionada por el driver ASUS (baseline): configúrala desde la UI del router',
  );
}

/**
 * Driver real para routers **ASUS / Asuswrt-Merlin** vía `appGet.cgi`
 * (lectura) y `applyapp.cgi` (escritura), sobre un `AsusClient` inyectable.
 * Inventario desde `get_clientlist()`, tráfico desde `get_traffics()`, WiFi por
 * nvram (`wl0_*`/`wl1_*`) y bloqueo por el filtro MAC (`MULTIFILTER_MAC`). La
 * lógica de parseo/construcción es pura (`asus.parsers`); aquí solo se orquesta.
 *
 * El bloqueo depende de que el **filtro MAC** del firmware esté activo; es un
 * baseline afinable en despliegue (ver `docs/asus-setup.md`).
 */
export class AsusDriver implements HardwareDriver {
  readonly kind = 'asus' as const;
  private readonly now: () => number;
  private lastCounters: Counters | null = null;

  constructor(private readonly opts: AsusDriverOptions) {
    this.now = opts.now ?? Date.now;
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.opts.client.get('nvram_get(productid)');
      return true;
    } catch {
      return false;
    }
  }

  async scanArp(): Promise<DiscoveredDevice[]> {
    return parseClientList(await this.opts.client.get('get_clientlist()'));
  }

  async scanMdns(): Promise<DiscoveredDevice[]> {
    // `get_clientlist` ya trae los nombres; no hay una fuente mDNS aparte.
    return [];
  }

  async getTrafficSample(): Promise<TrafficSampleResult> {
    const counters = parseTraffics(await this.opts.client.get('get_traffics()'));
    if (!counters) throw new Error('No se pudieron leer los contadores WAN de ASUS (get_traffics)');
    const t = this.now();
    const prev = this.lastCounters;
    this.lastCounters = { ...counters, t };
    const dt = prev ? (t - prev.t) / 1000 : 0;
    const rate = (curr: number, before: number) =>
      dt > 0 && curr >= before ? Math.round((curr - before) / dt) : 0;
    return {
      wan: {
        rxBytesPerSec: prev ? rate(counters.rxBytes, prev.rxBytes) : 0,
        txBytesPerSec: prev ? rate(counters.txBytes, prev.txBytes) : 0,
      },
      devices: [],
    };
  }

  async blockDevice(mac: string): Promise<void> {
    await this.updateMacFilter(mac, 'add');
  }

  async unblockDevice(mac: string): Promise<void> {
    await this.updateMacFilter(mac, 'remove');
  }

  private async updateMacFilter(mac: string, action: 'add' | 'remove'): Promise<void> {
    const nvram = parseNvram(await this.opts.client.get('nvram_get(MULTIFILTER_MAC)'));
    const next = buildMacFilter(nvram.MULTIFILTER_MAC ?? '', mac, action);
    await this.opts.client.apply({
      MULTIFILTER_ALL: '1',
      MULTIFILTER_ENABLE: '1',
      MULTIFILTER_MAC: next,
      rc_service: 'restart_firewall',
    });
  }

  // ---- WiFi ----

  private async readBand(prefix: string): Promise<{ ssid: string; security: WifiSecurityFields }> {
    const nvram = parseNvram(
      await this.opts.client.get(`nvram_get(${prefix}_ssid);nvram_get(${prefix}_auth_mode_x);nvram_get(${prefix}_closed)`),
    );
    return {
      ssid: nvram[`${prefix}_ssid`] ?? '',
      security: { authMode: nvram[`${prefix}_auth_mode_x`], closed: nvram[`${prefix}_closed`] === '1' },
    };
  }

  private async applyBand(prefix: string, input: UpdateWifiRequest | UpdateWifiNetworkRequest): Promise<void> {
    const params: Record<string, string> = { rc_service: 'restart_wireless' };
    if (input.ssid !== undefined) params[`${prefix}_ssid`] = input.ssid;
    if (input.password !== undefined) params[`${prefix}_wpa_psk`] = input.password;
    if (input.hidden !== undefined) params[`${prefix}_closed`] = input.hidden ? '1' : '0';
    await this.opts.client.apply(params);
  }

  private toWifiNetwork(band: WifiBand, data: { ssid: string; security: WifiSecurityFields }): WifiNetwork {
    return {
      ssid: data.ssid,
      enabled: true,
      band,
      security: securityFromAuthMode(data.security.authMode),
      hidden: data.security.closed,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  async getWifi(): Promise<WifiNetwork> {
    return this.toWifiNetwork('2.4GHz', await this.readBand('wl0'));
  }

  async updateWifi(input: UpdateWifiRequest): Promise<WifiNetwork> {
    await this.applyBand('wl0', input);
    return this.getWifi();
  }

  async getGuestNetwork(): Promise<GuestNetwork> {
    return guestUnsupported();
  }

  async updateGuestNetwork(_input: UpdateGuestNetworkRequest): Promise<GuestNetwork> {
    return guestUnsupported();
  }

  // ---- Multi-AP (un único AP: el router) ----

  async listAccessPoints(): Promise<AccessPoint[]> {
    const model = parseNvram(await this.opts.client.get('nvram_get(productid)')).productid;
    return [
      {
        id: AP_ID,
        name: model || 'ASUS',
        model: model ?? null,
        ip: this.opts.host ?? '',
        online: true,
        networkCount: BANDS.length,
      },
    ];
  }

  async listWifiNetworks(): Promise<WifiNetworkInfo[]> {
    const out: WifiNetworkInfo[] = [];
    for (const b of BANDS) {
      const data = await this.readBand(b.prefix);
      out.push(this.toWifiNetworkInfo(b, data));
    }
    return out;
  }

  private toWifiNetworkInfo(
    b: { id: string; band: WifiBand },
    data: { ssid: string; security: WifiSecurityFields },
  ): WifiNetworkInfo {
    return {
      id: b.id,
      apId: AP_ID,
      ssid: data.ssid,
      band: b.band,
      security: securityFromAuthMode(data.security.authMode),
      enabled: true,
      hidden: data.security.closed,
      isGuest: false,
      clientCount: 0,
    };
  }

  async getWifiNetwork(id: string): Promise<WifiNetworkInfo | null> {
    const b = BANDS.find((x) => x.id === id);
    if (!b) return null;
    return this.toWifiNetworkInfo(b, await this.readBand(b.prefix));
  }

  async updateWifiNetwork(
    id: string,
    input: UpdateWifiNetworkRequest,
  ): Promise<WifiNetworkInfo | null> {
    const b = BANDS.find((x) => x.id === id);
    if (!b) return null;
    await this.applyBand(b.prefix, input);
    return this.getWifiNetwork(id);
  }

  async listNetworkClients(id: string): Promise<WifiClient[] | null> {
    if (!BANDS.some((b) => b.id === id)) return null;
    // El detalle por-red/banda no se modela en este baseline.
    return [];
  }
}

interface WifiSecurityFields {
  authMode: string | undefined;
  closed: boolean;
}
