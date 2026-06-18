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
  blockRuleDescr,
  buildBlockRulePayload,
  ipForMac,
  parseFirewallRules,
  parsePfSenseArp,
  parsePfSenseInterfaceCounters,
  parsePfSenseLeases,
} from './pfsense.parsers.js';
import type { PfSenseClient } from './pfsense.transport.js';

export interface PfSenseDriverOptions {
  client: PfSenseClient;
  /** Nombre de la interfaz WAN para el muestreo de tráfico (por defecto `wan`). */
  wanInterface?: string;
  /** Interfaz donde se crean las reglas de bloqueo (por defecto `lan`). */
  lanInterface?: string;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

interface Counters {
  rxBytes: number;
  txBytes: number;
  t: number;
}

/** pfSense es un firewall/router, no un controlador WiFi. */
function wifiUnsupported(): never {
  throw new Error(
    'WiFi no gestionado por el driver pfSense: configura los puntos de acceso por separado',
  );
}

/**
 * Driver real para **pfSense** vía su REST API v2 (paquete pfSense API), sobre
 * un `PfSenseClient` inyectable. Implementa descubrimiento (ARP + leases DHCP),
 * tráfico (contadores de la interfaz WAN) y bloqueo (regla de firewall por IP,
 * resuelta desde la MAC). La gestión **WiFi no aplica** a pfSense: esos métodos
 * lanzan un error claro y los de multi-AP devuelven vacío.
 *
 * Bloqueo **baseline**: crea/borra una regla `block` etiquetada con la MAC y
 * aplica los cambios; afinable en despliegue (interfaz, alias, IPv6).
 */
export class PfSenseDriver implements HardwareDriver {
  readonly kind = 'pfsense' as const;
  private readonly wan: string;
  private readonly lan: string;
  private readonly now: () => number;
  private lastCounters: Counters | null = null;

  constructor(private readonly opts: PfSenseDriverOptions) {
    this.wan = opts.wanInterface ?? 'wan';
    this.lan = opts.lanInterface ?? 'lan';
    this.now = opts.now ?? Date.now;
  }

  async healthcheck(): Promise<boolean> {
    try {
      await this.opts.client.get('/api/v2/system/version');
      return true;
    } catch {
      return false;
    }
  }

  async scanArp(): Promise<DiscoveredDevice[]> {
    return parsePfSenseArp(await this.opts.client.get('/api/v2/diagnostics/arp_table'));
  }

  async scanMdns(): Promise<DiscoveredDevice[]> {
    // pfSense no hace mDNS; usamos las concesiones DHCP como fuente de hostnames.
    try {
      return parsePfSenseLeases(await this.opts.client.get('/api/v2/services/dhcp_server/leases'));
    } catch {
      return [];
    }
  }

  async getTrafficSample(): Promise<TrafficSample> {
    const counters = parsePfSenseInterfaceCounters(
      await this.opts.client.get('/api/v2/status/interface'),
      this.wan,
    );
    if (!counters) throw new Error(`Interfaz WAN no encontrada en pfSense: ${this.wan}`);
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
    const arp = parsePfSenseArp(await this.opts.client.get('/api/v2/diagnostics/arp_table'));
    const ip = ipForMac(arp, mac);
    if (!ip) throw new Error(`No se encontró IP para la MAC ${mac} en la tabla ARP de pfSense`);
    await this.opts.client.post('/api/v2/firewall/rule', buildBlockRulePayload(ip, mac, this.lan));
    await this.opts.client.post('/api/v2/firewall/apply', {});
  }

  async unblockDevice(mac: string): Promise<void> {
    try {
      const rules = parseFirewallRules(await this.opts.client.get('/api/v2/firewall/rules'));
      const descr = blockRuleDescr(mac);
      const rule = rules.find((r) => r.descr === descr);
      if (!rule) return; // no había regla: nada que hacer
      await this.opts.client.delete(`/api/v2/firewall/rule?id=${rule.id}`);
      await this.opts.client.post('/api/v2/firewall/apply', {});
    } catch {
      // Best-effort: un fallo al desbloquear no debe romper el flujo.
    }
  }

  // ---- WiFi: no aplica a pfSense ----

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
