import type { BlockedDomain, DnsQuery, DnsStats } from '@krakenos/types';

/**
 * Funciones puras de mapeo entre las respuestas de la API REST de Pi-hole (v6)
 * y los tipos del dominio de KrakenOS. No hablan con la red: reciben el JSON ya
 * deserializado y devuelven los tipos del contrato, de modo que se pueden testear
 * sin un Pi-hole real. La parte con I/O vive en `PiholeDnsManager`.
 */

/** Lee una propiedad numérica anidada con un valor por defecto seguro. */
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Estados de consulta que Pi-hole considera **bloqueados**. El resto
 * (`OK`, `FORWARDED`, `CACHE`, `RETRIED`, …) se tratan como permitidos.
 * Comparados en mayúsculas para tolerar variaciones de la API.
 */
const BLOCKED_STATUSES = new Set([
  'GRAVITY',
  'DENYLIST',
  'BLACKLIST',
  'REGEX',
  'REGEX_BLACKLIST',
  'EXTERNAL_BLOCKED_IP',
  'EXTERNAL_BLOCKED_NULL',
  'EXTERNAL_BLOCKED_NXRA',
  'EXTERNAL_BLOCKED_EDE15',
  'GRAVITY_CNAME',
  'REGEX_CNAME',
  'DENYLIST_CNAME',
  'BLACKLIST_CNAME',
  'SPECIAL_DOMAIN',
]);

/** `true` si el estado de consulta de Pi-hole corresponde a un bloqueo. */
export function isBlockedStatus(status: unknown): boolean {
  return typeof status === 'string' && BLOCKED_STATUSES.has(status.toUpperCase());
}

/**
 * Mapea `GET /api/stats/summary` a `DnsStats`. `blocklistSize` refleja el total
 * de dominios que el resolver bloquea (gravity), que es la capacidad real de
 * filtrado; la tabla de blocklist gestiona aparte los dominios `deny` manuales.
 */
export function parseSummary(json: unknown): DnsStats {
  const root = asRecord(json);
  const queries = asRecord(root.queries);
  const gravity = asRecord(root.gravity);
  const total = num(queries.total);
  const blocked = num(queries.blocked);
  // Pi-hole ya da `percent_blocked`; si faltara, se calcula desde los totales.
  const percent =
    queries.percent_blocked !== undefined
      ? num(queries.percent_blocked)
      : total > 0
        ? (blocked / total) * 100
        : 0;
  return {
    totalQueries: total,
    blockedQueries: blocked,
    blockedPercent: Math.round(percent),
    blocklistSize: num(gravity.domains_being_blocked),
  };
}

/**
 * Mapea `GET /api/domains/deny/exact` a `BlockedDomain[]`. El `id` expuesto es el
 * **propio dominio**: Pi-hole borra entradas por nombre de dominio
 * (`DELETE /api/domains/{type}/{kind}/{domain}`), no por id numérico, así que
 * usar el dominio como id mantiene `listBlocked`/`removeBlocked` consistentes.
 */
export function parseDenyExactList(json: unknown): BlockedDomain[] {
  const root = asRecord(json);
  const domains = Array.isArray(root.domains) ? root.domains : [];
  return domains
    .map((raw): BlockedDomain | null => {
      const entry = asRecord(raw);
      const domain = typeof entry.domain === 'string' ? entry.domain : null;
      if (!domain) return null;
      return {
        id: domain,
        domain,
        createdAt: new Date(num(entry.date_added) * 1000).toISOString(),
      };
    })
    .filter((d): d is BlockedDomain => d !== null)
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * Extrae la primera entrada de dominio de la respuesta de `POST /api/domains/...`
 * (Pi-hole devuelve `{ domains: [{ ... }] }`). Si no viniera, reconstruye la
 * entrada a partir del dominio solicitado.
 */
export function parseAddedDomain(json: unknown, requestedDomain: string): BlockedDomain {
  const [first] = parseDenyExactList(json);
  if (first) return first;
  return { id: requestedDomain, domain: requestedDomain, createdAt: new Date().toISOString() };
}

/** Mapea `GET /api/queries` a `DnsQuery[]` (más recientes primero, como los da Pi-hole). */
export function parseQueries(json: unknown, limit?: number): DnsQuery[] {
  const root = asRecord(json);
  const queries = Array.isArray(root.queries) ? root.queries : [];
  const mapped = queries
    .map((raw): DnsQuery | null => {
      const entry = asRecord(raw);
      const domain = typeof entry.domain === 'string' ? entry.domain : null;
      if (!domain) return null;
      // `client` puede venir como string o como `{ ip, name }`.
      const client =
        typeof entry.client === 'string'
          ? entry.client
          : (asRecord(entry.client).ip as string) || 'desconocido';
      return {
        timestamp: new Date(num(entry.time) * 1000).toISOString(),
        domain,
        client,
        blocked: isBlockedStatus(entry.status),
      };
    })
    .filter((q): q is DnsQuery => q !== null);
  return limit !== undefined ? mapped.slice(0, limit) : mapped;
}
