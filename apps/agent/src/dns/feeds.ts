/**
 * Catálogo FIJO de feeds de categoría (adlists) para el bloqueo DNS (US-114). Son
 * listas curadas y conocidas; el usuario solo las activa o desactiva. El resolver
 * (Pi-hole) las gestiona por URL — no se añaden dominio a dominio (una lista real
 * tiene 100k+ dominios).
 */
export interface DnsFeedCatalogEntry {
  id: string;
  name: string;
  description: string;
  url: string;
}

export const DNS_FEED_CATALOG: DnsFeedCatalogEntry[] = [
  {
    id: 'ads',
    name: 'Publicidad y rastreo',
    description: 'Bloquea anuncios, banners y rastreadores comunes (StevenBlack).',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
  },
  {
    id: 'malware',
    name: 'Malware y phishing',
    description: 'Dominios maliciosos y de phishing conocidos (URLhaus).',
    url: 'https://urlhaus.abuse.ch/downloads/hostfile/',
  },
  {
    id: 'tracking-extended',
    name: 'Rastreo extendido',
    description: 'Telemetría y rastreo adicional (lista de Perflyst/SmartTV opcional).',
    url: 'https://v.firebog.net/hosts/Easyprivacy.txt',
  },
];
