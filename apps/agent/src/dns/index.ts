import type { DnsKind, DnsManager } from '@krakenos/types';
import { MockDnsManager } from './mock.dns.js';

export interface DnsConfig {
  kind: DnsKind;
}

/**
 * Construye el gestor de DNS según la configuración. El resto del agente solo
 * conoce la interfaz `DnsManager`. `mock` está implementado; `pihole` (API de
 * Pi-hole) es la pieza de producción pendiente.
 */
export function createDnsManager(config: DnsConfig): DnsManager {
  switch (config.kind) {
    case 'mock':
      return new MockDnsManager();
    case 'pihole':
      throw new Error('Gestor Pi-hole real aún no implementado (API de Pi-hole)');
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de DNS desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockDnsManager, DnsError } from './mock.dns.js';
