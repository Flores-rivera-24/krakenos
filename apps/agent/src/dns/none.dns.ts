import type { BlockedDomain, DnsFeed, DnsManager, DnsQuery, DnsStats } from '@krakenos/types';
import { DomainNotConfiguredError } from '../integrations/not-configured.js';

/**
 * DNS «sin configurar» (`DNS_KIND=none`): no hay Pi-hole ni nada parecido. Sin estadísticas
 * reales (todo a cero, y el estado «sin configurar» viaja aparte), sin lista de bloqueo y
 * sin consultas; bloquear un dominio o activar un feed es un 409.
 */
export class NoneDnsManager implements DnsManager {
  readonly kind = 'none' as const;
  readonly notConfigured = true as const;

  async getStats(): Promise<DnsStats> {
    return { totalQueries: 0, blockedQueries: 0, blockedPercent: 0, blocklistSize: 0 };
  }

  async listBlocked(): Promise<BlockedDomain[]> {
    return [];
  }

  async addBlocked(_domain: string): Promise<BlockedDomain> {
    throw new DomainNotConfiguredError('dns');
  }

  async removeBlocked(_id: string): Promise<boolean> {
    throw new DomainNotConfiguredError('dns');
  }

  async recentQueries(_limit?: number): Promise<DnsQuery[]> {
    return [];
  }

  async listFeeds(): Promise<DnsFeed[]> {
    return [];
  }

  async setFeedEnabled(_id: string, _enabled: boolean): Promise<DnsFeed> {
    throw new DomainNotConfiguredError('dns');
  }
}
