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
  ARP_TABLE,
  DHCP_LEASES,
  PROC_NET_DEV,
  SYSTEM_HOSTNAME,
  UCI_COMMIT_WIRELESS,
  UCI_SHOW_WIRELESS,
  UPTIME,
  WIFI_RELOAD,
  blockMacCommand,
  iwinfoAssoc,
  normalizeMac,
  uciBandFromBand,
  uciEncryptionFromSecurity,
  uciSet,
  unblockMacCommand,
} from './openwrt.commands.js';
import {
  type UciSection,
  type UciWireless,
  bandFromDevice,
  isGuestIface,
  parseArpTable,
  parseDhcpLeases,
  parseIwinfoAssoc,
  parseProcNetDev,
  parseUciWireless,
  parseUmdnsHosts,
  securityFromUci,
} from './openwrt.parsers.js';
import type { OpenWrtTransport } from './openwrt.transport.js';

/** Único access point modelado: el propio dispositivo OpenWrt. */
const AP_ID = 'openwrt';

export interface OpenWrtDriverOptions {
  transport: OpenWrtTransport;
  /** Interfaz WAN para el muestreo de tráfico, p. ej. `eth1` o `wan`. */
  wanInterface: string;
  /** Nombre de la red UCI usada para invitados (por defecto `guest`). */
  guestNetwork?: string;
  /** Host del dispositivo, solo para mostrar en el access point. */
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
 * Driver real para routers **OpenWrt**, vía SSH+UCI. Opera contra un
 * `OpenWrtTransport` inyectable (comandos de shell en el router): descubrimiento
 * por ARP/leases/mDNS, tráfico desde `/proc/net/dev`, bloqueo por regla
 * `iptables` de MAC y WiFi vía `uci`/`iwinfo`. La lógica de parseo/construcción
 * de comandos es pura (módulos `openwrt.parsers`/`openwrt.commands`); aquí solo
 * se orquesta y se aplican efectos.
 *
 * Algunas piezas son **baseline** (refinables en despliegue): `scanMdns` depende
 * de `umdns`/leases, el `clientCount` por red se resuelve bajo demanda en
 * `listNetworkClients`, y el límite de ancho de banda de invitados no se mapea a UCI.
 */
export class OpenWrtDriver implements HardwareDriver {
  readonly kind = 'openwrt' as const;
  private readonly guestNetwork: string;
  private readonly now: () => number;
  private lastCounters: Counters | null = null;

  constructor(private readonly opts: OpenWrtDriverOptions) {
    this.guestNetwork = opts.guestNetwork ?? 'guest';
    this.now = opts.now ?? Date.now;
  }

  /** Ejecuta un comando y devuelve stdout; lanza si el código de salida no es 0. */
  private async run(command: string): Promise<string> {
    const { stdout, stderr, code } = await this.opts.transport.exec(command);
    if (code !== 0) {
      throw new Error(`Comando OpenWrt falló (code ${code}): ${command} — ${stderr.trim()}`);
    }
    return stdout;
  }

  /** Ejecuta un comando best-effort: devuelve stdout o `null` si falla. */
  private async tryRun(command: string): Promise<string | null> {
    try {
      return await this.run(command);
    } catch {
      return null;
    }
  }

  async healthcheck(): Promise<boolean> {
    return (await this.tryRun(UPTIME)) !== null;
  }

  async scanArp(): Promise<DiscoveredDevice[]> {
    return parseArpTable(await this.run(ARP_TABLE));
  }

  /**
   * Descubre hostnames vía mDNS (`umdns`) y, como fuente adicional fiable en
   * OpenWrt, las concesiones DHCP de dnsmasq. Resuelve la MAC cruzando por IP
   * con la tabla ARP. Degrada con gracia si `umdns`/leases no están.
   */
  async scanMdns(): Promise<DiscoveredDevice[]> {
    const arp = parseArpTable((await this.tryRun(ARP_TABLE)) ?? '');
    const ipToMac = new Map(arp.map((d) => [d.ip, d.mac]));
    const macToIp = new Map(arp.map((d) => [d.mac, d.ip]));
    const byMac = new Map<string, DiscoveredDevice>();

    // mDNS (umdns): hostname + ipv4 → MAC vía ARP.
    await this.tryRun('ubus call umdns update');
    const umdnsRaw = await this.tryRun('ubus call umdns hosts');
    if (umdnsRaw) {
      try {
        for (const { hostname, ip } of parseUmdnsHosts(JSON.parse(umdnsRaw))) {
          const mac = ipToMac.get(ip);
          if (mac) byMac.set(mac, { mac, ip, hostname, source: 'mdns' });
        }
      } catch {
        // JSON inesperado: se ignora y se sigue con las leases.
      }
    }

    // DHCP leases (dnsmasq): mac → hostname; la IP sale de la lease o del ARP.
    for (const [mac, hostname] of parseDhcpLeases((await this.tryRun(DHCP_LEASES)) ?? '')) {
      if (byMac.has(mac)) continue;
      const ip = macToIp.get(mac);
      if (ip) byMac.set(mac, { mac, ip, hostname, source: 'mdns' });
    }
    return [...byMac.values()];
  }

  async getTrafficSample(): Promise<TrafficSampleResult> {
    const counters = parseProcNetDev(await this.run(PROC_NET_DEV), this.opts.wanInterface);
    if (!counters) {
      throw new Error(`Interfaz WAN no encontrada en /proc/net/dev: ${this.opts.wanInterface}`);
    }
    const t = this.now();
    const prev = this.lastCounters;
    this.lastCounters = { ...counters, t };
    // Primera muestra o contadores reiniciados: sin tasa todavía.
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
    await this.run(blockMacCommand(normalizeMac(mac)));
  }

  async unblockDevice(mac: string): Promise<void> {
    // Best-effort: si la regla no existía, no es un error.
    await this.tryRun(unblockMacCommand(normalizeMac(mac)));
  }

  // ---- WiFi ----

  private async loadWireless(): Promise<UciWireless> {
    return parseUciWireless(await this.run(UCI_SHOW_WIRELESS));
  }

  /** Primera iface AP que no sea de invitados (la red principal). */
  private primaryIface(w: UciWireless): UciSection | null {
    return (
      w.ifaces.find(
        (i) => (i.options.mode ?? 'ap') === 'ap' && !isGuestIface(i, this.guestNetwork),
      ) ?? null
    );
  }

  private guestIface(w: UciWireless): UciSection | null {
    return w.ifaces.find((i) => isGuestIface(i, this.guestNetwork)) ?? null;
  }

  private toWifiNetwork(iface: UciSection, w: UciWireless): WifiNetwork {
    return {
      ssid: iface.options.ssid ?? '',
      enabled: iface.options.disabled !== '1',
      band: bandFromDevice(w.devices[iface.options.device ?? '']),
      security: securityFromUci(iface.options.encryption),
      hidden: iface.options.hidden === '1',
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  /** Construye los comandos `uci set` para una actualización de red WiFi. */
  private wifiSetCommands(
    iface: UciSection,
    input: UpdateWifiRequest | UpdateWifiNetworkRequest,
  ): string[] {
    const cmds: string[] = [];
    if (input.ssid !== undefined) cmds.push(uciSet(iface.name, 'ssid', input.ssid));
    if (input.password !== undefined) cmds.push(uciSet(iface.name, 'key', input.password));
    if (input.enabled !== undefined) {
      cmds.push(uciSet(iface.name, 'disabled', input.enabled ? '0' : '1'));
    }
    if (input.security !== undefined) {
      cmds.push(uciSet(iface.name, 'encryption', uciEncryptionFromSecurity(input.security)));
    }
    if (input.hidden !== undefined) cmds.push(uciSet(iface.name, 'hidden', input.hidden ? '1' : '0'));
    if (input.band !== undefined && iface.options.device) {
      cmds.push(uciSet(iface.options.device, 'band', uciBandFromBand(input.band)));
    }
    return cmds;
  }

  /** Aplica los `uci set`, confirma y recarga la WiFi. */
  private async applyWifi(cmds: string[]): Promise<void> {
    for (const cmd of cmds) await this.run(cmd);
    await this.run(UCI_COMMIT_WIRELESS);
    await this.run(WIFI_RELOAD);
  }

  async getWifi(): Promise<WifiNetwork> {
    const w = await this.loadWireless();
    const iface = this.primaryIface(w);
    if (!iface) throw new Error('No se encontró una red WiFi principal en la config UCI');
    return this.toWifiNetwork(iface, w);
  }

  async updateWifi(input: UpdateWifiRequest): Promise<WifiNetwork> {
    const w = await this.loadWireless();
    const iface = this.primaryIface(w);
    if (!iface) throw new Error('No se encontró una red WiFi principal en la config UCI');
    await this.applyWifi(this.wifiSetCommands(iface, input));
    return this.getWifi();
  }

  async getGuestNetwork(): Promise<GuestNetwork> {
    const w = await this.loadWireless();
    const iface = this.guestIface(w);
    if (!iface) throw new Error('No se encontró una red de invitados en la config UCI');
    return this.toGuestNetwork(iface);
  }

  private toGuestNetwork(iface: UciSection): GuestNetwork {
    return {
      ssid: iface.options.ssid ?? '',
      enabled: iface.options.disabled !== '1',
      clientIsolation: iface.options.isolate === '1',
      // El límite de ancho de banda no se mapea a UCI (baseline de despliegue).
      bandwidthLimitMbps: null,
      updatedAt: new Date(this.now()).toISOString(),
    };
  }

  async updateGuestNetwork(input: UpdateGuestNetworkRequest): Promise<GuestNetwork> {
    const w = await this.loadWireless();
    const iface = this.guestIface(w);
    if (!iface) throw new Error('No se encontró una red de invitados en la config UCI');
    const cmds: string[] = [];
    if (input.ssid !== undefined) cmds.push(uciSet(iface.name, 'ssid', input.ssid));
    if (input.password !== undefined) cmds.push(uciSet(iface.name, 'key', input.password));
    if (input.enabled !== undefined) cmds.push(uciSet(iface.name, 'disabled', input.enabled ? '0' : '1'));
    if (input.clientIsolation !== undefined) {
      cmds.push(uciSet(iface.name, 'isolate', input.clientIsolation ? '1' : '0'));
    }
    await this.applyWifi(cmds);
    return this.getGuestNetwork();
  }

  // ---- Multi-AP (un único AP: el dispositivo OpenWrt) ----

  async listAccessPoints(): Promise<AccessPoint[]> {
    const w = await this.loadWireless();
    const hostname = (await this.tryRun(SYSTEM_HOSTNAME))?.trim() || 'OpenWrt';
    return [
      {
        id: AP_ID,
        name: hostname,
        model: null,
        ip: this.opts.host ?? '',
        online: true,
        networkCount: w.ifaces.length,
      },
    ];
  }

  async listWifiNetworks(): Promise<WifiNetworkInfo[]> {
    const w = await this.loadWireless();
    return w.ifaces.map((iface) => this.toWifiNetworkInfo(iface, w));
  }

  private toWifiNetworkInfo(iface: UciSection, w: UciWireless): WifiNetworkInfo {
    return {
      id: iface.name,
      apId: AP_ID,
      ssid: iface.options.ssid ?? '',
      band: bandFromDevice(w.devices[iface.options.device ?? '']),
      security: securityFromUci(iface.options.encryption),
      enabled: iface.options.disabled !== '1',
      hidden: iface.options.hidden === '1',
      isGuest: isGuestIface(iface, this.guestNetwork),
      // Conteo bajo demanda en listNetworkClients (evita N+1 execs aquí).
      clientCount: 0,
    };
  }

  async getWifiNetwork(id: string): Promise<WifiNetworkInfo | null> {
    const w = await this.loadWireless();
    const iface = w.ifaces.find((i) => i.name === id);
    return iface ? this.toWifiNetworkInfo(iface, w) : null;
  }

  async updateWifiNetwork(
    id: string,
    input: UpdateWifiNetworkRequest,
  ): Promise<WifiNetworkInfo | null> {
    const w = await this.loadWireless();
    const iface = w.ifaces.find((i) => i.name === id);
    if (!iface) return null;
    await this.applyWifi(this.wifiSetCommands(iface, input));
    return this.getWifiNetwork(id);
  }

  async listNetworkClients(id: string): Promise<WifiClient[] | null> {
    const w = await this.loadWireless();
    const iface = w.ifaces.find((i) => i.name === id);
    if (!iface) return null;
    const ifname = iface.options.ifname;
    if (!ifname) return []; // sin ifname conocido no se puede consultar iwinfo (baseline)

    const assoc = parseIwinfoAssoc((await this.tryRun(iwinfoAssoc(ifname))) ?? '');
    const arp = parseArpTable((await this.tryRun(ARP_TABLE)) ?? '');
    const macToIp = new Map(arp.map((d) => [d.mac, d.ip]));
    const macToHost = parseDhcpLeases((await this.tryRun(DHCP_LEASES)) ?? '');
    return assoc.map((c) => ({
      mac: c.mac,
      hostname: macToHost.get(c.mac) ?? null,
      ip: macToIp.get(c.mac) ?? '',
      signalDbm: c.signalDbm,
    }));
  }
}
