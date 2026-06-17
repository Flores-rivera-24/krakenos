import type {
  DiscoveredDevice,
  GuestNetwork,
  HardwareDriver,
  TrafficSample,
  UpdateGuestNetworkRequest,
  UpdateWifiRequest,
  WifiNetwork,
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
}
