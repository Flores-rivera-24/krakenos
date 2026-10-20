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
import { DomainNotConfiguredError } from '../integrations/not-configured.js';

/**
 * Driver «sin configurar» (`DRIVER_KIND=none`): no hay router conectado.
 *
 * Es lo que arranca una instalación real hasta que el usuario conecta el suyo, en lugar
 * del mock (que inventa una casa con aparatos y un WiFi que no existen). Las lecturas con
 * forma vacía (`scanArp`, listas de redes…) devuelven vacío y **el estado «sin configurar»
 * viaja aparte** (`GET /api/integrations/status`): un `[]` solo es ambiguo, y la UI no
 * adivina. Lo que no tiene forma vacía (el WiFi principal, una muestra de tráfico) o
 * escribe, lanza {@link DomainNotConfiguredError} (409).
 *
 * `notConfigured` permite a los barridos de fondo (inventario, tráfico) no sondear lo que
 * no existe, en vez de llamar y registrar un fallo por ciclo.
 */
export class NoneDriver implements HardwareDriver {
  readonly kind = 'none' as const;
  readonly notConfigured = true as const;

  async healthcheck(): Promise<boolean> {
    return false;
  }

  async scanArp(): Promise<DiscoveredDevice[]> {
    return [];
  }

  async scanMdns(): Promise<DiscoveredDevice[]> {
    return [];
  }

  async getTrafficSample(): Promise<TrafficSampleResult> {
    throw new DomainNotConfiguredError('driver');
  }

  async blockDevice(_mac: string): Promise<void> {
    throw new DomainNotConfiguredError('driver');
  }

  async unblockDevice(_mac: string): Promise<void> {
    throw new DomainNotConfiguredError('driver');
  }

  async getWifi(): Promise<WifiNetwork> {
    throw new DomainNotConfiguredError('driver');
  }

  async updateWifi(_input: UpdateWifiRequest): Promise<WifiNetwork> {
    throw new DomainNotConfiguredError('driver');
  }

  async getGuestNetwork(): Promise<GuestNetwork> {
    throw new DomainNotConfiguredError('driver');
  }

  async updateGuestNetwork(_input: UpdateGuestNetworkRequest): Promise<GuestNetwork> {
    throw new DomainNotConfiguredError('driver');
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
    throw new DomainNotConfiguredError('driver');
  }

  async listNetworkClients(_id: string): Promise<WifiClient[] | null> {
    return null;
  }
}
