import { randomUUID } from 'node:crypto';
import type { BlockedDomain, DnsManager, DnsQuery, DnsStats } from '@krakenos/types';

/** Error de dominio del DNS con código estable. */
export class DnsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Gestor de DNS en memoria para desarrollo. Mantiene una blocklist y un
 * registro de consultas simulado sin hablar con Pi-hole. Las estadísticas de
 * volumen son contadores fijos de demostración; el tamaño de la blocklist sí
 * refleja los cambios.
 */
export class MockDnsManager implements DnsManager {
  readonly kind = 'mock' as const;
  private readonly blocked = new Map<string, BlockedDomain>();
  private seq = 0;

  // Contadores de demostración (deterministas).
  private readonly totalQueries = 1280;
  private readonly blockedQueries = 312;

  private readonly queries: DnsQuery[] = [
    { timestamp: '2026-06-17T10:00:00.000Z', domain: 'ads.doubleclick.net', client: '10.0.0.21', blocked: true },
    { timestamp: '2026-06-17T10:00:03.000Z', domain: 'github.com', client: '10.0.0.10', blocked: false },
    { timestamp: '2026-06-17T10:00:05.000Z', domain: 'telemetry.vendor.io', client: '10.0.0.33', blocked: true },
    { timestamp: '2026-06-17T10:00:08.000Z', domain: 'api.weather.com', client: '10.0.0.10', blocked: false },
    { timestamp: '2026-06-17T10:00:11.000Z', domain: 'tracker.example.com', client: '10.0.0.21', blocked: true },
    { timestamp: '2026-06-17T10:00:14.000Z', domain: 'cdn.jsdelivr.net', client: '10.0.0.15', blocked: false },
  ];

  constructor() {
    for (const domain of ['ads.doubleclick.net', 'tracker.example.com', 'telemetry.vendor.io']) {
      this.insert(domain);
    }
  }

  private insert(domain: string): BlockedDomain {
    const entry: BlockedDomain = {
      id: randomUUID(),
      domain,
      // Timestamp determinista y creciente, sin depender del reloj.
      createdAt: new Date(++this.seq * 1000).toISOString(),
    };
    this.blocked.set(entry.id, entry);
    return entry;
  }

  async getStats(): Promise<DnsStats> {
    return {
      totalQueries: this.totalQueries,
      blockedQueries: this.blockedQueries,
      blockedPercent: Math.round((this.blockedQueries / this.totalQueries) * 100),
      blocklistSize: this.blocked.size,
    };
  }

  async listBlocked(): Promise<BlockedDomain[]> {
    return [...this.blocked.values()].sort((a, b) => a.domain.localeCompare(b.domain));
  }

  async addBlocked(domain: string): Promise<BlockedDomain> {
    const normalized = domain.trim().toLowerCase();
    if ([...this.blocked.values()].some((b) => b.domain === normalized)) {
      throw new DnsError('DOMAIN_EXISTS', `El dominio ${normalized} ya está bloqueado`);
    }
    return this.insert(normalized);
  }

  async removeBlocked(id: string): Promise<boolean> {
    return this.blocked.delete(id);
  }

  async recentQueries(limit = 50): Promise<DnsQuery[]> {
    return [...this.queries].reverse().slice(0, limit);
  }
}
