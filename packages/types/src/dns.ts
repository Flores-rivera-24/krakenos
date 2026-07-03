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
 * Feed de categoría (adlist): una lista curada de dominios a bloquear que el
 * resolver (Pi-hole) gestiona por URL. El catálogo es fijo; el usuario activa o
 * desactiva cada uno (US-114).
 */
export interface DnsFeed {
  id: string;
  name: string;
  description: string;
  url: string;
  enabled: boolean;
}

export interface UpdateDnsFeedRequest {
  enabled: boolean;
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
  /** Catálogo de feeds de categoría con su estado activo (US-114). */
  listFeeds(): Promise<DnsFeed[]>;
  /** Activa o desactiva un feed por id; lanza si el id no está en el catálogo. */
  setFeedEnabled(id: string, enabled: boolean): Promise<DnsFeed>;
}
