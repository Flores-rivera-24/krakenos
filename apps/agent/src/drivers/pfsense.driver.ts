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
  blockRuleDescr,
  buildBlockRulePayload,
  type FirewallRuleRef,
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

  async getTrafficSample(): Promise<TrafficSampleResult> {
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
      wan: {
        rxBytesPerSec: prev ? rate(counters.rxBytes, prev.rxBytes) : 0,
        txBytesPerSec: prev ? rate(counters.txBytes, prev.txBytes) : 0,
      },
      devices: [], // este driver no reporta tráfico por dispositivo
    };
  }

  async blockDevice(mac: string): Promise<void> {
    const arp = parsePfSenseArp(await this.opts.client.get('/api/v2/diagnostics/arp_table'));
    const ip = ipForMac(arp, mac);
    const descr = blockRuleDescr(mac);
    const rules = parseFirewallRules(await this.opts.client.get('/api/v2/firewall/rules'));
    const mine = rules.filter((r) => r.descr === descr);
    if (!ip) {
      // Apagado: si ya hay regla se conserva (el reafirmado no es un error).
      if (mine.length > 0) return;
      throw new Error(`No se encontró IP para la MAC ${mac} en la tabla ARP de pfSense`);
    }
    // Idempotente: una sola regla y con la IP actual (la regla es por IP, y DHCP la
    // puede haber cambiado). Si no cuadra, se quitan las viejas y se crea la nueva.
    if (mine.length === 1 && mine[0]!.source === ip) return;
    // Primero se CREA la nueva: si el POST falla no se ha quitado nada y el aparato no
    // queda sin regla. Luego se relee (no se fía de ids anteriores al POST) y se retiran
    // solo las viejas; un fallo ahí deja dos reglas (inocuo, el siguiente reafirmado limpia).
    await this.opts.client.post('/api/v2/firewall/rule', buildBlockRulePayload(ip, mac, this.lan));
    const after = parseFirewallRules(await this.opts.client.get('/api/v2/firewall/rules'));
    await this.deleteRules(after.filter((r) => r.descr === descr && r.source !== ip));
    await this.opts.client.post('/api/v2/firewall/apply', {});
  }

  /** Borra reglas de mayor a menor id (por si el id es posicional). Sin `apply`. */
  private async deleteRules(rules: FirewallRuleRef[]): Promise<void> {
    for (const rule of [...rules].sort((x, y) => y.id - x.id)) {
      await this.opts.client.delete(`/api/v2/firewall/rule?id=${rule.id}`);
    }
  }

  async unblockDevice(mac: string): Promise<void> {
    const rules = parseFirewallRules(await this.opts.client.get('/api/v2/firewall/rules'));
    const descr = blockRuleDescr(mac);
    const mine = rules.filter((r) => r.descr === descr);
    if (mine.length === 0) return; // no había regla: nada que hacer
    // Un fallo se propaga: el llamante solo marca el aparato como desbloqueado tras el
    // éxito del driver.
    await this.deleteRules(mine);
    await this.opts.client.post('/api/v2/firewall/apply', {});
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
