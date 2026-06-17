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

/**
 * Driver de desarrollo: devuelve datos en memoria sin tocar hardware real.
 * Útil para levantar el stack completo sin un router pfSense/OpenWrt.
 */
export class MockDriver implements HardwareDriver {
  readonly kind = 'mock' as const;

  private wifi: WifiNetwork = {
    ssid: 'KrakenOS',
    enabled: true,
    band: '5GHz',
    security: 'wpa2/wpa3',
    hidden: false,
    updatedAt: new Date().toISOString(),
  };

  private guest: GuestNetwork = {
    ssid: 'KrakenOS-Invitados',
    enabled: false,
    clientIsolation: true,
    bandwidthLimitMbps: 50,
    updatedAt: new Date().toISOString(),
  };

  async healthcheck(): Promise<boolean> {
    return true;
  }

  async scanArp(): Promise<DiscoveredDevice[]> {
    // MACs con OUIs reales; el fabricante lo resuelve el lookup OUI del agente.
    return [
      { mac: '24:5a:4c:11:22:33', ip: '192.168.1.1', source: 'arp' },
      { mac: 'f0:18:98:aa:bb:cc', ip: '192.168.1.42', source: 'arp' },
      { mac: '24:0a:c4:de:ad:01', ip: '192.168.1.77', source: 'arp' },
      { mac: 'dc:a6:32:de:ad:02', ip: '192.168.1.50', source: 'arp' },
    ];
  }

  async scanMdns(): Promise<DiscoveredDevice[]> {
    // mDNS aporta hostnames y, a veces, un dispositivo extra (p. ej. un Chromecast).
    return [
      { mac: '24:5a:4c:11:22:33', ip: '192.168.1.1', hostname: 'gateway', source: 'mdns' },
      { mac: 'f0:18:98:aa:bb:cc', ip: '192.168.1.42', hostname: 'macbook-emilio', source: 'mdns' },
      { mac: 'dc:a6:32:de:ad:02', ip: '192.168.1.50', hostname: 'raspberrypi', source: 'mdns' },
      { mac: 'd8:3a:dd:00:cc:01', ip: '192.168.1.90', hostname: 'chromecast-tv', source: 'mdns' },
    ];
  }

  /** Conjunto en memoria de MACs bloqueadas (el hardware real enviaría reglas al router). */
  private readonly blocked = new Set<string>();

  async blockDevice(mac: string): Promise<void> {
    this.blocked.add(mac.toLowerCase());
  }

  async unblockDevice(mac: string): Promise<void> {
    this.blocked.delete(mac.toLowerCase());
  }

  // Estado para un random-walk suave de ancho de banda (bytes/seg).
  private rx = 1_500_000;
  private tx = 300_000;

  async getTrafficSample(): Promise<TrafficSample> {
    const walk = (v: number, max: number) => {
      const next = v + (Math.random() - 0.5) * max * 0.3;
      return Math.max(0, Math.min(max, next));
    };
    this.rx = walk(this.rx, 12_000_000); // ~100 Mbps de descarga máx
    this.tx = walk(this.tx, 3_000_000); // ~24 Mbps de subida máx
    return {
      timestamp: new Date().toISOString(),
      rxBytesPerSec: Math.round(this.rx),
      txBytesPerSec: Math.round(this.tx),
    };
  }

  async getWifi(): Promise<WifiNetwork> {
    return this.wifi;
  }

  async updateWifi(input: UpdateWifiRequest): Promise<WifiNetwork> {
    const { password: _password, ...rest } = input;
    this.wifi = { ...this.wifi, ...rest, updatedAt: new Date().toISOString() };
    return this.wifi;
  }

  async getGuestNetwork(): Promise<GuestNetwork> {
    return this.guest;
  }

  async updateGuestNetwork(input: UpdateGuestNetworkRequest): Promise<GuestNetwork> {
    const { password: _password, ...rest } = input;
    this.guest = { ...this.guest, ...rest, updatedAt: new Date().toISOString() };
    return this.guest;
  }

  // ---- Multi-AP (Fase 2) ----

  private accessPoints: AccessPoint[] = [
    { id: 'ap-salon', name: 'AP Salón', model: 'KrakenAP Pro', ip: '192.168.1.2', online: true, networkCount: 3 },
    { id: 'ap-planta1', name: 'AP Planta 1', model: 'KrakenAP Lite', ip: '192.168.1.3', online: true, networkCount: 1 },
  ];

  private networks: WifiNetworkInfo[] = [
    { id: 'net-salon-5', apId: 'ap-salon', ssid: 'KrakenOS', band: '5GHz', security: 'wpa2/wpa3', enabled: true, hidden: false, isGuest: false, clientCount: 4 },
    { id: 'net-salon-24', apId: 'ap-salon', ssid: 'KrakenOS', band: '2.4GHz', security: 'wpa2/wpa3', enabled: true, hidden: false, isGuest: false, clientCount: 2 },
    { id: 'net-salon-guest', apId: 'ap-salon', ssid: 'KrakenOS-Invitados', band: '2.4GHz', security: 'wpa2', enabled: false, hidden: false, isGuest: true, clientCount: 0 },
    { id: 'net-planta1-5', apId: 'ap-planta1', ssid: 'KrakenOS', band: '5GHz', security: 'wpa2/wpa3', enabled: true, hidden: false, isGuest: false, clientCount: 1 },
  ];

  private clientsByNetwork: Record<string, WifiClient[]> = {
    'net-salon-5': [
      { mac: 'f0:18:98:aa:bb:cc', hostname: 'macbook-emilio', ip: '192.168.1.42', signalDbm: -48 },
      { mac: 'dc:a6:32:de:ad:02', hostname: 'raspberrypi', ip: '192.168.1.50', signalDbm: -61 },
    ],
    'net-salon-24': [{ mac: '24:0a:c4:de:ad:01', hostname: null, ip: '192.168.1.77', signalDbm: -70 }],
    'net-planta1-5': [{ mac: 'd8:3a:dd:00:cc:01', hostname: 'chromecast-tv', ip: '192.168.1.90', signalDbm: -55 }],
  };

  async listAccessPoints(): Promise<AccessPoint[]> {
    return this.accessPoints;
  }

  async listWifiNetworks(): Promise<WifiNetworkInfo[]> {
    return this.networks;
  }

  async getWifiNetwork(id: string): Promise<WifiNetworkInfo | null> {
    return this.networks.find((n) => n.id === id) ?? null;
  }

  async updateWifiNetwork(
    id: string,
    input: UpdateWifiNetworkRequest,
  ): Promise<WifiNetworkInfo | null> {
    const idx = this.networks.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    const { password: _password, ...rest } = input;
    const current = this.networks[idx]!;
    const updated: WifiNetworkInfo = { ...current, ...rest };
    this.networks[idx] = updated;
    return updated;
  }

  async listNetworkClients(id: string): Promise<WifiClient[] | null> {
    if (!this.networks.some((n) => n.id === id)) return null;
    return this.clientsByNetwork[id] ?? [];
  }
}
