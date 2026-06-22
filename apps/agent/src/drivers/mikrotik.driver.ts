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
  BLOCK_LIST,
  blockComment,
  blockEntryId,
  ipForMac,
  parseMikrotikArp,
  parseMikrotikInterface,
  parseMikrotikLeases,
  parseMikrotikWireless,
} from './mikrotik.parsers.js';
import type { MikrotikTransport } from './mikrotik.transport.js';

/** Id del access point lógico que agrupa las WLANs (el propio router). */
const AP_ID = 'mikrotik';

/** Se lanza cuando el router no soporta una operación (p. ej. sin WiFi). */
export class FeatureNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureNotSupportedError';
  }
}

export interface MikrotikDriverOptions {
  transport: MikrotikTransport;
  /** Interfaz WAN para el muestreo de tráfico (por defecto `ether1`). */
  wanInterface?: string;
  /** Host del router, solo para mostrar en el access point. */
  host?: string;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

interface Counters {
  rxBytes: number;
  txBytes: number;
  t: number;
}

/**
 * Driver real para routers **MikroTik / RouterOS**, sobre un `MikrotikTransport`
 * inyectable (modo REST o SSH, elegido en la factory). Implementa inventario
 * (ARP + concesiones DHCP), tráfico (contadores de la interfaz WAN), bloqueo
 * (entrada en la address-list `krakenos-blocked` + regla drop) y WiFi si el
 * router tiene interfaz wireless. La lógica de parseo/construcción es pura
 * (`mikrotik.parsers`); aquí solo se orquesta.
 */
export class MikrotikDriver implements HardwareDriver {
  readonly kind = 'mikrotik' as const;
  private readonly wan: string;
  private readonly now: () => number;
  private lastCounters: Counters | null = null;

  constructor(private readonly opts: MikrotikDriverOptions) {
    this.wan = opts.wanInterface ?? 'ether1';
    this.now = opts.now ?? Date.now;
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.opts.transport.list('system/resource');
      return true;
    } catch {
      return false;
    }
  }

  async scanArp(): Promise<DiscoveredDevice[]> {
    return parseMikrotikArp(await this.opts.transport.list('ip/arp'));
  }

  async scanMdns(): Promise<DiscoveredDevice[]> {
    // RouterOS no hace mDNS; las concesiones DHCP son la fuente de hostnames.
    try {
      return parseMikrotikLeases(await this.opts.transport.list('ip/dhcp-server/lease'));
    } catch {
      return [];
    }
  }

  async getTrafficSample(): Promise<TrafficSampleResult> {
    const counters = parseMikrotikInterface(await this.opts.transport.list('interface'), this.wan);
    if (!counters) throw new Error(`Interfaz WAN no encontrada en RouterOS: ${this.wan}`);
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
      devices: [], // este driver no reporta tráfico por dispositivo
    };
  }

  /** Garantiza que existe la regla drop que descarta la address-list de bloqueo. */
  private async ensureDropRule(): Promise<void> {
    const rules = await this.opts.transport.list('ip/firewall/filter');
    const exists = rules.some(
      (r) => r['src-address-list'] === BLOCK_LIST && r.action === 'drop',
    );
    if (!exists) {
      await this.opts.transport.add('ip/firewall/filter', {
        chain: 'forward',
        'src-address-list': BLOCK_LIST,
        action: 'drop',
        comment: 'krakenos-block-rule',
      });
    }
  }

  async blockDevice(mac: string): Promise<void> {
    const arp = await this.opts.transport.list('ip/arp');
    const ip = ipForMac(arp, mac);
    if (!ip) throw new Error(`No se encontró IP para la MAC ${mac} en la tabla ARP de RouterOS`);
    await this.ensureDropRule();
    await this.opts.transport.add('ip/firewall/address-list', {
      list: BLOCK_LIST,
      address: ip,
      comment: blockComment(mac),
    });
  }

  async unblockDevice(mac: string): Promise<void> {
    try {
      const arp = await this.opts.transport.list('ip/arp');
      const ip = ipForMac(arp, mac);
      const entries = await this.opts.transport.list('ip/firewall/address-list');
      const id = blockEntryId(entries, mac, ip);
      if (id) await this.opts.transport.remove('ip/firewall/address-list', id);
    } catch {
      // Best-effort: un fallo al desbloquear no debe romper el flujo.
    }
  }

  // ---- WiFi (solo si el router tiene interfaz wireless) ----

  private async loadWireless(): Promise<WifiNetworkInfo[]> {
    let rows: Record<string, unknown>[];
    try {
      rows = await this.opts.transport.list('interface/wireless');
    } catch {
      // El menú no existe (sin paquete wireless / RouterOS sin WiFi).
      throw new FeatureNotSupportedError('Este router MikroTik no expone interfaces WiFi (wireless)');
    }
    const wlans = parseMikrotikWireless(rows, AP_ID);
    if (wlans.length === 0) {
      throw new FeatureNotSupportedError('Este router MikroTik no tiene interfaces WiFi configuradas');
    }
    return wlans;
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

  /** Construye los `props` del `set` de wireless a partir de una actualización. */
  private wirelessSetProps(input: UpdateWifiRequest | UpdateWifiNetworkRequest): Record<string, string> {
    const props: Record<string, string> = {};
    if (input.ssid !== undefined) props.ssid = input.ssid;
    if (input.enabled !== undefined) props.disabled = input.enabled ? 'no' : 'yes';
    if (input.hidden !== undefined) props['hide-ssid'] = input.hidden ? 'yes' : 'no';
    return props;
  }

  async getWifi(): Promise<WifiNetwork> {
    const wlans = await this.loadWireless();
    return this.toWifiNetwork(wlans[0]!);
  }

  async updateWifi(input: UpdateWifiRequest): Promise<WifiNetwork> {
    const wlans = await this.loadWireless();
    await this.opts.transport.set('interface/wireless', wlans[0]!.id, this.wirelessSetProps(input));
    return this.getWifi();
  }

  async getGuestNetwork(): Promise<GuestNetwork> {
    // RouterOS no modela una red de invitados estándar; queda fuera del driver.
    throw new FeatureNotSupportedError('Red de invitados no gestionada por el driver MikroTik');
  }

  async updateGuestNetwork(_input: UpdateGuestNetworkRequest): Promise<GuestNetwork> {
    throw new FeatureNotSupportedError('Red de invitados no gestionada por el driver MikroTik');
  }

  // ---- Multi-AP (un único AP: el router) ----

  async listAccessPoints(): Promise<AccessPoint[]> {
    let wlans: WifiNetworkInfo[];
    try {
      wlans = await this.loadWireless();
    } catch {
      return []; // router sin WiFi: ningún AP
    }
    return [
      {
        id: AP_ID,
        name: this.opts.host ?? 'MikroTik',
        model: null,
        ip: this.opts.host ?? '',
        online: true,
        networkCount: wlans.length,
      },
    ];
  }

  async listWifiNetworks(): Promise<WifiNetworkInfo[]> {
    try {
      return await this.loadWireless();
    } catch {
      return [];
    }
  }

  async getWifiNetwork(id: string): Promise<WifiNetworkInfo | null> {
    try {
      return (await this.loadWireless()).find((w) => w.id === id) ?? null;
    } catch {
      return null;
    }
  }

  async updateWifiNetwork(
    id: string,
    input: UpdateWifiNetworkRequest,
  ): Promise<WifiNetworkInfo | null> {
    let wlans: WifiNetworkInfo[];
    try {
      wlans = await this.loadWireless();
    } catch {
      return null;
    }
    if (!wlans.some((w) => w.id === id)) return null;
    await this.opts.transport.set('interface/wireless', id, this.wirelessSetProps(input));
    return this.getWifiNetwork(id);
  }

  async listNetworkClients(id: string): Promise<WifiClient[] | null> {
    let wlans: WifiNetworkInfo[];
    try {
      wlans = await this.loadWireless();
    } catch {
      return null;
    }
    if (!wlans.some((w) => w.id === id)) return null;
    // Registration table bajo demanda (baseline): sin señal por cliente fiable aquí.
    return [];
  }
}
