import type { DnsFeed, DnsFeedId } from '@krakenos/types';

/**
 * Catálogo FIJO de feeds de categoría (adlists) para el bloqueo DNS (US-114). Son
 * listas curadas y conocidas; el usuario solo las activa o desactiva. El resolver
 * (Pi-hole) las gestiona por URL — no se añaden dominio a dominio (una lista real
 * tiene 100k+ dominios).
 */
export interface DnsFeedCatalogEntry {
  id: DnsFeedId;
  /**
   * Nombre para el agente (el comentario de la adlist en Pi-hole). **No viaja a la
   * web**: el copy de la UI vive en su catálogo, traducido, y la API manda solo el
   * `id` (ver `DnsFeed`).
   */
  name: string;
  url: string;
}

/** Lo que sale por la API: el id, la URL y si está activo (sin copy). */
export function toDnsFeed(entry: DnsFeedCatalogEntry, enabled: boolean): DnsFeed {
  return { id: entry.id, url: entry.url, enabled };
}

export const DNS_FEED_CATALOG: DnsFeedCatalogEntry[] = [
  {
    id: 'ads',
    name: 'Publicidad y rastreo',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  },
  {
    id: 'malware',
    name: 'Malware y phishing',
    url: 'https://urlhaus.abuse.ch/downloads/hostfile/',
  },
  {
    id: 'tracking-extended',
    name: 'Rastreo extendido',
    url: 'https://v.firebog.net/hosts/Easyprivacy.txt',
  },
];
