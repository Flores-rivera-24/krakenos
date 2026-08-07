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
 * Entrada del **histórico** DNS persistido (US-252). Se diferencia de `DnsQuery`
 * en lo único que importa: aquí el aparato está **resuelto**, y resuelto **en el
 * momento de la ingesta**.
 *
 * ⚠️ La MAC se guarda con la fila y no se cruza al leer, a propósito: las IP de
 * la LAN se reasignan por DHCP, así que resolver a posteriori atribuiría la
 * navegación de ayer a quien tenga esa IP hoy. En un histórico de navegación eso
 * no es una imprecisión, es acusar a la persona equivocada.
 */
export interface DnsHistoryEntry {
  id: Id;
  timestamp: IsoDateTime;
  domain: string;
  blocked: boolean;
  /** MAC del aparato resuelta en la ingesta; `null` si esa IP no era de nadie del inventario. */
  mac: string | null;
  /** Etiqueta del aparato en el inventario en el momento de leer; `null` si ya no está. */
  deviceLabel: string | null;
}

/**
 * Lo que el histórico **no** ve, publicado con los datos y no en un aparte
 * (US-252). Un panel de actividad DNS que no diga esto miente justo con los
 * aparatos que preocupan: el que resuelve por DoH o lleva un DNS a fuego no
 * aparece, y su ausencia es indistinguible de «no ha hecho nada».
 */
export interface DnsHistoryCoverage {
  /** ¿Ha llegado alguna consulta al histórico? Con `false`, la tabla vacía es eso y no «silencio». */
  recording: boolean;
  /**
   * Aparatos **en línea** del inventario sin ni una consulta en la ventana. No se
   * afirma que usen DoH —también pueden estar sin actividad—: se dice el número y
   * se explican las dos causas.
   */
  silentDevices: number;
  /** Aparatos en línea considerados, para que el número de arriba tenga denominador. */
  onlineDevices: number;
  /** Días que se conservan las consultas antes de podarse. */
  retentionDays: number;
}

/** Respuesta del histórico: las entradas **y** lo que no se ve, juntas. */
export interface DnsHistoryResponse {
  entries: DnsHistoryEntry[];
  coverage: DnsHistoryCoverage;
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
