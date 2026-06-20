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
  configureBlockMacCommand,
  removeBlockMacCommand,
  showArpCommand,
  showInterfacesCommand,
  showVersionCommand,
} from './cisco-ios.commands.js';
import { arpToDevices, parseArp, parseInterfaces } from './cisco-ios.parsers.js';
import type { CiscoTransport } from './cisco-ios.transport.js';

export interface CiscoIosDriverOptions {
  transport: CiscoTransport;
  /** Interfaz WAN para el muestreo de tráfico, p. ej. `GigabitEthernet0/0`. */
  interface: string;
  /** VLAN por defecto para las entradas de bloqueo estáticas (por defecto `1`). */
  vlan?: string;
  /** Host del dispositivo, solo para mostrar. */
  host?: string;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

interface Counters {
  rxBytes: number;
  txBytes: number;
  t: number;
}

/** Los switches/routers Cisco gestionados no exponen WiFi controlable. */
function wifiUnsupported(): never {
  throw new Error(
    'WiFi no gestionado por el driver Cisco IOS: los APs WiFi se configuran por separado',
  );
}

/**
 * Driver real para switches y routers **Cisco IOS / IOS-XE** vía SSH + CLI de
 * IOS, sobre un `CiscoTransport` inyectable. Implementa descubrimiento (tabla
 * ARP), tráfico (contadores de la interfaz WAN) y bloqueo (entrada estática
 * `drop` en la MAC table). La lógica de parseo/construcción de comandos es pura
 * (`cisco-ios.parsers`/`cisco-ios.commands`); aquí solo se orquesta.
 *
 * La gestión **WiFi no aplica** a switches Cisco: esos métodos lanzan un error
 * claro y los de multi-AP devuelven vacío. El descubrimiento por hostname/mDNS
 * no existe en IOS (`scanMdns` devuelve vacío) — baseline de despliegue.
 */
export class CiscoIosDriver implements HardwareDriver {
  readonly kind = 'cisco-ios' as const;
  private readonly vlan: string;
  private readonly now: () => number;
  private lastCounters: Counters | null = null;

  constructor(private readonly opts: CiscoIosDriverOptions) {
    this.vlan = opts.vlan ?? '1';
    this.now = opts.now ?? Date.now;
  }

  private async tryRun(command: string): Promise<string | null> {
    try {
      return await this.opts.transport.execute(command);
    } catch {
      return null;
    }
  }

  async healthcheck(): Promise<boolean> {
    const out = await this.tryRun(showVersionCommand());
    return out !== null && out.length > 0;
  }

  async scanArp(): Promise<DiscoveredDevice[]> {
    return arpToDevices(parseArp(await this.opts.transport.execute(showArpCommand())));
  }

  async scanMdns(): Promise<DiscoveredDevice[]> {
    // IOS no ofrece mDNS ni resolución de hostnames del lado del switch.
    return [];
  }

  async getTrafficSample(): Promise<TrafficSampleResult> {
    const counters = parseInterfaces(
      await this.opts.transport.execute(showInterfacesCommand(this.opts.interface)),
    );
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
    await this.opts.transport.executePrivileged(configureBlockMacCommand(mac, this.vlan));
  }

  async unblockDevice(mac: string): Promise<void> {
    // Best-effort: si la entrada no existía, no es un error.
    try {
      await this.opts.transport.executePrivileged(removeBlockMacCommand(mac, this.vlan));
    } catch {
      // ignora
    }
  }

  // ---- WiFi: no aplica a switches Cisco ----

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
