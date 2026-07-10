import type { IsoDateTime } from './common.js';
import type { IntegrationDomain } from './integrations.js';

/**
 * Auto-descubrimiento de dispositivos IoT (US-175): sondeo mDNS/SSDP **solo en
 * la LAN** (multicast, TTL 1; nunca sale nada fuera) + huellas por integración.
 * La app propone («Encontramos un bridge Hue — ¿conectar?») y el usuario
 * confirma en el asistente de Conectar, precargado con lo detectado.
 */

/** Sugerencia de integración detectada en la red. */
export interface DiscoverySuggestion {
  /** Id estable `kind:ip` (dedupe + descartes persistidos). */
  id: string;
  domain: IntegrationDomain;
  /** `kind` del backend que la configuraría (hue, shelly, zigbee, kasa, rtsp…). */
  kind: string;
  /** Etiqueta humana ("Bridge Philips Hue"). */
  label: string;
  ip: string;
  hostname: string | null;
  /**
   * Valores para precargar el asistente (clave de campo del `kindSchema`, sin
   * namespacing; nunca secretos).
   */
  prefill: Record<string, string>;
  source: 'mdns' | 'ssdp';
  lastSeen: IsoDateTime;
}

/** Respuesta de `GET /api/discovery` y de `POST /api/discovery/scan`. */
export interface DiscoveryStatus {
  suggestions: DiscoverySuggestion[];
  scanning: boolean;
  lastScanAt: IsoDateTime | null;
}
