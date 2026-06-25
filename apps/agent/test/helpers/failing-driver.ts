import type {
  AccessPoint,
  DiscoveredDevice,
  GuestNetwork,
  HardwareDriver,
  TrafficSampleResult,
  WifiClient,
  WifiNetwork,
  WifiNetworkInfo,
} from '@krakenos/types';

/**
 * Modos de fallo que `FailingDriver` puede simular:
 *
 * - `throw`   — todas las operaciones rechazan de inmediato (driver caído, auth
 *               inválida, comando que devuelve error).
 * - `timeout` — las operaciones rechazan tras un retardo con un error estilo
 *               `ETIMEDOUT` (red lenta / dispositivo que no responde). No se
 *               modela un *hang* infinito porque colgaría el propio test; el
 *               retardo basta para probar que el llamante espera y no asume
 *               respuesta inmediata.
 * - `garbage` — las operaciones resuelven con formas malformadas (tipos
 *               equivocados, `null`, no-arrays) para destapar parsers que
 *               confían ciegamente en el contrato.
 * - `empty`   — las operaciones resuelven con vacíos válidos (`[]`, `null`):
 *               la red existe pero no reporta nada.
 */
export type DriverFailureMode = 'throw' | 'timeout' | 'garbage' | 'empty';

export interface FailingDriverOptions {
  /** Retardo (ms) antes de rechazar en modo `timeout`. Por defecto 20 ms. */
  timeoutMs?: number;
}

/**
 * Driver de inyección de fallos: implementa el **mismo contrato**
 * (`HardwareDriver`) que `MockDriver` y se inyecta igual (vía `buildTestApp` o
 * directamente en un servicio), pero ejercita los **caminos de error** que el
 * mock feliz nunca toca. `kind: 'mock'` para no alterar la lógica que dependa
 * del tipo de driver — lo único que cambia es el comportamiento de fallo.
 */
export class FailingDriver implements HardwareDriver {
  readonly kind = 'mock' as const;

  constructor(
    private readonly mode: DriverFailureMode,
    private readonly opts: FailingDriverOptions = {},
  ) {}

  /** Núcleo: resuelve con `value` (empty), garbage, o rechaza (throw/timeout). */
  private async react<T>(value: T, garbage: unknown): Promise<T> {
    switch (this.mode) {
      case 'throw':
        throw new Error(`FailingDriver: fallo simulado (${this.kind})`);
      case 'timeout':
        return new Promise<T>((_resolve, reject) => {
          const t = setTimeout(
            () => reject(new Error('FailingDriver: ETIMEDOUT (operación expiró)')),
            this.opts.timeoutMs ?? 20,
          );
          // No mantener vivo el proceso de test sólo por este temporizador.
          t.unref?.();
        });
      case 'garbage':
        return garbage as T;
      case 'empty':
        return value;
    }
  }

  healthcheck(): Promise<boolean> {
    // En `empty` el dispositivo responde pero "no sano"; en `garbage`, un no-booleano.
    return this.react<boolean>(false, 'no-soy-un-booleano');
  }

  scanArp(): Promise<DiscoveredDevice[]> {
    return this.react<DiscoveredDevice[]>([], [{ mac: 12345, ip: null, source: 'arp' }, null]);
  }

  scanMdns(): Promise<DiscoveredDevice[]> {
    return this.react<DiscoveredDevice[]>([], { not: 'an array' });
  }

  getTrafficSample(): Promise<TrafficSampleResult> {
    return this.react<TrafficSampleResult>(
      { wan: { rxBytesPerSec: 0, txBytesPerSec: 0 }, devices: [] },
      { wan: null, devices: [{ mac: null, ip: 7 }] },
    );
  }

  blockDevice(): Promise<void> {
    return this.react<void>(undefined, undefined);
  }

  unblockDevice(): Promise<void> {
    return this.react<void>(undefined, undefined);
  }

  getWifi(): Promise<WifiNetwork> {
    return this.react<WifiNetwork>(
      {
        ssid: '',
        enabled: false,
        band: '5GHz',
        security: 'wpa2/wpa3',
        hidden: false,
        updatedAt: new Date(0).toISOString(),
      },
      null,
    );
  }

  updateWifi(): Promise<WifiNetwork> {
    return this.react<WifiNetwork>(
      {
        ssid: '',
        enabled: false,
        band: '5GHz',
        security: 'wpa2/wpa3',
        hidden: false,
        updatedAt: new Date(0).toISOString(),
      },
      { ssid: 42 },
    );
  }

  getGuestNetwork(): Promise<GuestNetwork> {
    return this.react<GuestNetwork>(
      {
        ssid: '',
        enabled: false,
        clientIsolation: true,
        bandwidthLimitMbps: 0,
        updatedAt: new Date(0).toISOString(),
      },
      'no-soy-un-objeto',
    );
  }

  updateGuestNetwork(): Promise<GuestNetwork> {
    return this.react<GuestNetwork>(
      {
        ssid: '',
        enabled: false,
        clientIsolation: true,
        bandwidthLimitMbps: 0,
        updatedAt: new Date(0).toISOString(),
      },
      null,
    );
  }

  listAccessPoints(): Promise<AccessPoint[]> {
    return this.react<AccessPoint[]>([], 'not-an-array');
  }

  listWifiNetworks(): Promise<WifiNetworkInfo[]> {
    return this.react<WifiNetworkInfo[]>([], 42);
  }

  getWifiNetwork(): Promise<WifiNetworkInfo | null> {
    return this.react<WifiNetworkInfo | null>(null, { id: 99 });
  }

  updateWifiNetwork(): Promise<WifiNetworkInfo | null> {
    return this.react<WifiNetworkInfo | null>(null, { id: 99 });
  }

  listNetworkClients(): Promise<WifiClient[] | null> {
    return this.react<WifiClient[] | null>(null, { nope: true });
  }
}
