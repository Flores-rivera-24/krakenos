import type { DiscoveredDevice, DiscoverySource } from '@krakenos/types';

const VALID_SOURCES: ReadonlySet<string> = new Set<DiscoverySource>(['arp', 'mdns', 'manual']);

export interface NormalizeDiscoveredResult {
  /** Entradas válidas, ya saneadas. */
  devices: DiscoveredDevice[];
  /** Cuántas entradas malformadas se descartaron. */
  dropped: number;
}

/**
 * Endurece la **frontera del driver**: valida la salida de `scanArp`/`scanMdns`
 * y descarta las entradas malformadas en vez de confiar ciegamente en el
 * contrato. Un driver con bug (o uno real con una respuesta corrupta) podría
 * devolver `mac` numérica, `null`, o ni siquiera un array; sin esto, el
 * `d.mac.toLowerCase()` del merge reventaría con un `TypeError` (US-98).
 */
export function normalizeDiscovered(raw: unknown): NormalizeDiscoveredResult {
  if (!Array.isArray(raw)) {
    // Ni siquiera es una lista: todo descartado, pero contamos algo (>0) para avisar.
    return { devices: [], dropped: raw == null ? 0 : 1 };
  }
  const devices: DiscoveredDevice[] = [];
  let dropped = 0;
  for (const entry of raw) {
    const device = toDiscovered(entry);
    if (device) devices.push(device);
    else dropped += 1;
  }
  return { devices, dropped };
}

/** Convierte una entrada desconocida en `DiscoveredDevice`, o `null` si es inválida. */
function toDiscovered(entry: unknown): DiscoveredDevice | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.mac !== 'string' || e.mac.length === 0) return null;
  if (typeof e.ip !== 'string') return null;
  if (typeof e.source !== 'string' || !VALID_SOURCES.has(e.source)) return null;
  return {
    mac: e.mac,
    ip: e.ip,
    hostname: typeof e.hostname === 'string' ? e.hostname : null,
    vendor: typeof e.vendor === 'string' ? e.vendor : null,
    source: e.source as DiscoverySource,
  };
}
