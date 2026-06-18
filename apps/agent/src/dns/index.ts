import type { DnsKind, DnsManager } from '@krakenos/types';
import { MockDnsManager } from './mock.dns.js';
import { PiholeDnsManager } from './pihole.dns.js';

/** Config específica del gestor Pi-hole real (`kind: 'pihole'`). */
export interface PiholeManagerConfig {
  /** URL base de Pi-hole, p. ej. `http://pi.hole`. */
  baseUrl: string;
  /** Contraseña de la web/app de Pi-hole; vacía si no está configurada. */
  password?: string;
}

export interface DnsConfig {
  kind: DnsKind;
  /** Requerido cuando `kind === 'pihole'`. */
  pihole?: PiholeManagerConfig;
}

/**
 * Construye el gestor de DNS según la configuración. El resto del agente solo
 * conoce la interfaz `DnsManager`. `mock` mantiene la blocklist y las
 * estadísticas en memoria; `pihole` habla con la API REST de Pi-hole (v6).
 */
export function createDnsManager(config: DnsConfig): DnsManager {
  switch (config.kind) {
    case 'mock':
      return new MockDnsManager();
    case 'pihole': {
      const pihole = config.pihole;
      if (!pihole) throw new Error('Falta la configuración Pi-hole (DnsConfig.pihole)');
      return new PiholeDnsManager({ baseUrl: pihole.baseUrl, password: pihole.password });
    }
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de DNS desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockDnsManager, DnsError } from './mock.dns.js';
export { PiholeDnsManager } from './pihole.dns.js';
