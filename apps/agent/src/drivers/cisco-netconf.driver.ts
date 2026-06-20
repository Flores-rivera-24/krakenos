import type {
  AccessPoint,
  DiscoveredDevice,
  GuestNetwork,
  HardwareDriver,
  TrafficSample,
  UpdateGuestNetworkRequest,
  UpdateWifiNetworkRequest,
  UpdateWifiRequest,
  WifiClient,
  WifiNetwork,
  WifiNetworkInfo,
} from '@krakenos/types';
import {
  arpFilter,
  blockMacConfig,
  interfacesFilter,
  unblockMacConfig,
} from './cisco-netconf.commands.js';
import {
  netconfArpToDevices,
  parseNetconfArp,
  parseNetconfInterface,
} from './cisco-netconf.parsers.js';
import type { NetconfTransport } from './cisco-netconf.transport.js';

export interface CiscoNetconfDriverOptions {
  transport: NetconfTransport;
  /** Interfaz WAN para el muestreo de tráfico, p. ej. `GigabitEthernet1`. */
  interface: string;
  host?: string;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

interface Counters {
  rxBytes: number;
  txBytes: number;
  t: number;
}

function wifiUnsupported(): never {
  throw new Error('WiFi no gestionado por el driver Cisco NETCONF (switch/router gestionado)');
}

/**
 * Driver real para **Cisco IOS-XE 16.6+** vía **NETCONF** (XML estructurado sobre
 * SSH, puerto 830), sobre un `NetconfTransport` inyectable. Alternativa moderna y
 * transaccional al CLI del driver `cisco-ios` (US-37): descubrimiento por el
 * modelo YANG `arp-oper`, tráfico por `interfaces-oper` y bloqueo por una ACL MAC
 * vía `edit-config`. Parseo/builders puros (`cisco-netconf.parsers`/`.commands`).
 *
 * Como en `cisco-ios`, la gestión WiFi no aplica y `scanMdns` es vacío.
 */
export class CiscoNetconfDriver implements HardwareDriver {
  readonly kind = 'cisco-netconf' as const;
  private readonly now: () => number;
  private lastCounters: Counters | null = null;

  constructor(private readonly opts: CiscoNetconfDriverOptions) {
    this.now = opts.now ?? Date.now;
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.opts.transport.get(arpFilter());
      return true;
    } catch {
      return false;
    }
  }

  async scanArp(): Promise<DiscoveredDevice[]> {
    return netconfArpToDevices(parseNetconfArp(await this.opts.transport.get(arpFilter())));
  }

  async scanMdns(): Promise<DiscoveredDevice[]> {
    return [];
  }

  async getTrafficSample(): Promise<TrafficSample> {
    const counters = parseNetconfInterface(
      await this.opts.transport.get(interfacesFilter()),
      this.opts.interface,
    );
    if (!counters) {
      throw new Error(`Interfaz no encontrada vía NETCONF: ${this.opts.interface}`);
    }
    const t = this.now();
    const prev = this.lastCounters;
    this.lastCounters = { ...counters, t };
    const dt = prev ? (t - prev.t) / 1000 : 0;
    const rate = (curr: number, before: number) =>
      dt > 0 && curr >= before ? Math.round((curr - before) / dt) : 0;
    return {
      timestamp: new Date(t).toISOString(),
      rxBytesPerSec: prev ? rate(counters.rxBytes, prev.rxBytes) : 0,
      txBytesPerSec: prev ? rate(counters.txBytes, prev.txBytes) : 0,
    };
  }

  async blockDevice(mac: string): Promise<void> {
    await this.opts.transport.editConfig(blockMacConfig(mac));
  }

  async unblockDevice(mac: string): Promise<void> {
    try {
      await this.opts.transport.editConfig(unblockMacConfig(mac));
    } catch {
      // Best-effort: si la ACL no existía, no es un error.
    }
  }

  // ---- WiFi: no aplica ----

  async getWifi(): Promise<WifiNetwork> {
    return wifiUnsupported();
  }

  async updateWifi(_input: UpdateWifiRequest): Promise<WifiNetwork> {
    return wifiUnsupported();
  }

  async getGuestNetwork(): Promise<GuestNetwork> {
    return wifiUnsupported();
  }

  async updateGuestNetwork(_input: UpdateGuestNetworkRequest): Promise<GuestNetwork> {
    return wifiUnsupported();
  }

  async listAccessPoints(): Promise<AccessPoint[]> {
    return [];
  }

  async listWifiNetworks(): Promise<WifiNetworkInfo[]> {
    return [];
  }

  async getWifiNetwork(_id: string): Promise<WifiNetworkInfo | null> {
    return null;
  }

  async updateWifiNetwork(
    _id: string,
    _input: UpdateWifiNetworkRequest,
  ): Promise<WifiNetworkInfo | null> {
    return null;
  }

  async listNetworkClients(_id: string): Promise<WifiClient[] | null> {
    return null;
  }
}
