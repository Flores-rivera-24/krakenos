import type { DiscoveryStatus, DiscoverySuggestion } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { encodeMdnsQuery, parseMdnsResponse } from '../../discovery/dns.js';
import { buildMSearch, parseSsdpResponse } from '../../discovery/ssdp.js';
import { matchFingerprints, type DiscoveryProbeRecord } from '../../discovery/fingerprints.js';
import {
  MDNS_GROUP,
  MDNS_PORT,
  SSDP_GROUP,
  SSDP_PORT,
  type DiscoveryTransport,
} from '../../discovery/transport.js';

/** Servicios mDNS que consultamos (los que las huellas saben reconocer). */
const MDNS_SERVICES = [
  '_hue._tcp.local',
  '_shelly._tcp.local',
  '_mqtt._tcp.local',
  '_onvif._tcp.local',
  '_http._tcp.local',
];

/** Clave interna de `Setting` con los ids de sugerencias descartadas. */
const DISMISSED_KEY = 'discovery.dismissed';

/** Una sugerencia que lleva 1 h sin re-verse se retira (el aparato ya no está). */
const STALE_MS = 60 * 60 * 1000;

/** Barrido periódico suave por defecto: cada 10 min. */
const DEFAULT_SWEEP_MS = 10 * 60 * 1000;

/** Espera de respuestas por sondeo. */
const DEFAULT_WAIT_MS = 2500;

/**
 * Tope de sugerencias vivas: un host LAN hostil puede fabricar parejas
 * `kind:ip` sin límite en un datagrama; una casa real tiene decenas de
 * aparatos, no miles. Al llegar al tope, lo nuevo se descarta (con aviso).
 */
const MAX_SUGGESTIONS = 100;

/** Tope del listado persistido de descartes (se conservan los más recientes). */
const MAX_DISMISSED = 500;

/**
 * Auto-descubrimiento de IoT (US-175): sondea la LAN por mDNS y SSDP (solo
 * multicast local; el transporte garantiza el no-egress), casa las respuestas
 * contra huellas puras (`discovery/fingerprints.ts`) y mantiene en memoria las
 * sugerencias («Encontramos un bridge Hue»). Barrido bajo demanda + periódico
 * suave con coalescing por descarte (patrón `inventory:rescan`). Los descartes
 * del usuario se persisten en `Setting` y los backends ya configurados no se
 * vuelven a sugerir.
 */
export class DiscoveryService {
  private readonly suggestions = new Map<string, DiscoverySuggestion>();
  private isScanning = false;
  private timer: NodeJS.Timeout | null = null;
  private lastScanAt: Date | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly transport: DiscoveryTransport,
    private readonly waitMs = DEFAULT_WAIT_MS,
  ) {}

  /** Un barrido completo: sondea, casa huellas y actualiza las sugerencias. */
  async scan(now: Date = new Date()): Promise<void> {
    const records: DiscoveryProbeRecord[] = [];

    try {
      const responses = await this.transport.probe(
        MDNS_GROUP,
        MDNS_PORT,
        encodeMdnsQuery(MDNS_SERVICES),
        this.waitMs,
      );
      for (const response of responses) {
        for (const instance of parseMdnsResponse(response.data)) {
          records.push({
            type: 'mdns',
            service: instance.service,
            name: instance.name,
            ip: instance.ip ?? response.from,
            port: instance.port,
            txt: instance.txt,
          });
        }
      }
    } catch (err) {
      this.app.log.warn({ err }, '[discovery] el sondeo mDNS falló; se omite');
    }

    try {
      const responses = await this.transport.probe(
        SSDP_GROUP,
        SSDP_PORT,
        buildMSearch(),
        this.waitMs,
      );
      for (const response of responses) {
        const headers = parseSsdpResponse(response.data);
        if (headers) records.push({ type: 'ssdp', ip: response.from, headers });
      }
    } catch (err) {
      this.app.log.warn({ err }, '[discovery] el sondeo SSDP falló; se omite');
    }

    let dropped = 0;
    for (const match of matchFingerprints(records)) {
      const id = `${match.kind}:${match.ip}`;
      if (!this.suggestions.has(id) && this.suggestions.size >= MAX_SUGGESTIONS) {
        dropped += 1;
        continue;
      }
      this.suggestions.set(id, { ...match, id, lastSeen: now.toISOString() });
    }
    if (dropped > 0) {
      this.app.log.warn(
        { dropped },
        '[discovery] tope de sugerencias alcanzado; se descartan las nuevas',
      );
    }
    // Retira lo que lleva demasiado sin re-verse (el aparato salió de la red).
    for (const [id, suggestion] of this.suggestions) {
      if (now.getTime() - Date.parse(suggestion.lastSeen) > STALE_MS) {
        this.suggestions.delete(id);
      }
    }
    this.lastScanAt = now;
  }

  /**
   * Barrido con coalescing por descarte (patrón `inventory:rescan`): si ya hay
   * uno en curso, el disparo extra se ignora. Nunca propaga errores.
   */
  async scanCycle(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;
    try {
      await this.scan();
    } catch (err) {
      this.app.log.error({ err }, '[discovery] el barrido falló; se omite este ciclo');
    } finally {
      this.isScanning = false;
    }
  }

  /** Ids descartados por el usuario, desde `Setting` (parseo defensivo US-63). */
  private async dismissedIds(): Promise<Set<string>> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: DISMISSED_KEY } });
    if (!row) return new Set();
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      this.app.log.warn('[discovery] ajuste discovery.dismissed corrupto; se ignora');
      return new Set();
    }
  }

  /** Descarta una sugerencia (persistido: no vuelve a aparecer tras re-verla). */
  async dismiss(id: string): Promise<void> {
    const ids = await this.dismissedIds();
    ids.delete(id); // re-descartar la mueve al final (la más reciente)
    ids.add(id);
    // Acotado: el listado no crece sin límite (se conservan los más recientes).
    const value = JSON.stringify([...ids].slice(-MAX_DISMISSED));
    await this.app.prisma.setting.upsert({
      where: { key: DISMISSED_KEY },
      create: { key: DISMISSED_KEY, value },
      update: { value },
    });
  }

  /** Backends ya configurados desde la UI (no se re-sugieren). */
  private async configuredKinds(): Promise<Set<string>> {
    const kinds = new Set<string>();
    const rows = await this.app.prisma.integrationConfig.findMany({
      where: { domain: { in: ['iot', 'cameras'] }, enabled: true },
    });
    for (const row of rows) {
      for (const kind of row.kind.split(',')) kinds.add(kind.trim());
    }
    return kinds;
  }

  /** Estado observable: sugerencias vigentes (sin descartadas ni ya configuradas). */
  async status(): Promise<DiscoveryStatus> {
    const [dismissed, configured] = await Promise.all([
      this.dismissedIds(),
      this.configuredKinds(),
    ]);
    const suggestions = [...this.suggestions.values()]
      .filter((s) => !dismissed.has(s.id) && !configured.has(s.kind))
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      suggestions,
      scanning: this.isScanning,
      lastScanAt: this.lastScanAt ? this.lastScanAt.toISOString() : null,
    };
  }

  start(intervalMs = DEFAULT_SWEEP_MS): void {
    if (this.timer) return;
    void this.scanCycle();
    this.timer = setInterval(() => void this.scanCycle(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
