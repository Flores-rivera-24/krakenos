import type {
  DiscoveredDevice,
  GuestNetwork,
  HardwareDriver,
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
    return [
      { mac: 'aa:bb:cc:00:11:22', ip: '192.168.1.1', hostname: 'gateway', vendor: 'Ubiquiti', source: 'arp' },
      { mac: 'de:ad:be:ef:00:01', ip: '192.168.1.42', hostname: 'desktop', vendor: 'Intel', source: 'arp' },
      { mac: 'de:ad:be:ef:00:02', ip: '192.168.1.77', hostname: null, vendor: 'Espressif', source: 'arp' },
    ];
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
