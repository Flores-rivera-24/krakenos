import type { Id, IsoDateTime } from './common.js';

/** Implementaciones de gestor de DNS disponibles. */
export type DnsKind = 'mock' | 'pihole';

/** Estadísticas agregadas del resolver DNS. */
export interface DnsStats {
  /** Consultas totales en la ventana reciente. */
  totalQueries: number;
  /** Consultas bloqueadas por la blocklist. */
  blockedQueries: number;
  /** Porcentaje bloqueado (0-100, redondeado). */
  blockedPercent: number;
  /** Nº de dominios en la blocklist. */
  blocklistSize: number;
}

/** Dominio en la lista de bloqueo. */
export interface BlockedDomain {
  id: Id;
  domain: string;
  createdAt: IsoDateTime;
}

/** Entrada del registro reciente de consultas DNS. */
export interface DnsQuery {
  timestamp: IsoDateTime;
  domain: string;
  /** IP del cliente que hizo la consulta. */
  client: string;
  /** `true` si la consulta fue bloqueada. */
  blocked: boolean;
}

export interface AddBlockedDomainRequest {
  domain: string;
}

/**
 * Gestor de DNS intercambiable. La implementación real (`pihole`) habla con la
 * API de Pi-hole; `mock` mantiene la blocklist y las estadísticas en memoria.
 */
export interface DnsManager {
  getStats(): Promise<DnsStats>;
  listBlocked(): Promise<BlockedDomain[]>;
  /** Añade un dominio a la blocklist. Lanza si ya existe. */
  addBlocked(domain: string): Promise<BlockedDomain>;
  /** Quita un dominio de la blocklist; `false` si no existía. */
  removeBlocked(id: Id): Promise<boolean>;
  /** Últimas consultas DNS (más recientes primero). */
  recentQueries(limit?: number): Promise<DnsQuery[]>;
}
