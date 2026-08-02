import type {
  DiscoveryStatus,
  DiscoverySuggestion,
  IntegrationConfigValues,
  IntegrationDomain,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { esAdoptable, fusionaPrefill, yaConfigurado } from '../../discovery/adopt.js';
import type { IntegrationConfigStore } from '../../integrations/integration-config.store.js';
import type { IntegrationRuntime } from '../../integrations/runtime.js';
import { saveDomainConfig } from '../../integrations/save-domain-config.js';
import { getKindSchema } from '../../integrations/schema.js';
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
  // US-249: un ESPHome en la red es la señal de que la ingesta genérica (US-248)
  // es la vía; el aparato se anuncia con este servicio.
  '_esphomelib._tcp.local',
  '_onvif._tcp.local',
  '_http._tcp.local',
];

/** Clave interna de `Setting` con los ids de sugerencias descartadas. */
const DISMISSED_KEY = 'discovery.dismissed';

/** Una sugerencia que lleva 1 h sin re-verse se retira (el aparato ya no está). */
const STALE_MS = 60 * 60 * 1000;

/** La sugerencia existe pero necesita datos que solo puede dar el usuario. */
export class AdopcionNoPosibleError extends Error {
  constructor(readonly kind: string) {
    super(`La integración ${kind} necesita datos que no se pueden descubrir`);
    this.name = 'AdopcionNoPosibleError';
  }
}

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
    /**
     * Config guardada y runtime recargable. Son opcionales para que los tests del
     * sondeo (y cualquier uso sin integraciones) no tengan que montarlos; sin
     * ellos, la adopción de un toque simplemente no se ofrece.
     */
    private readonly store?: IntegrationConfigStore,
    private readonly runtime?: IntegrationRuntime,
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
      // `adoptable` lo decide `status()`: depende de la config guardada, que puede
      // cambiar entre barridos (adoptar un Shelly no debe dejar el siguiente
      // marcado como si aún no tuviera dónde ir).
      this.suggestions.set(id, { ...match, id, lastSeen: now.toISOString(), adoptable: false });
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

  /** Valores ya guardados de un dominio (secretos descifrados, `{}` si no hay). */
  private async valoresDe(domain: IntegrationDomain): Promise<IntegrationConfigValues> {
    if (!this.store) return {};
    const record = await this.store.getDecrypted(domain);
    return record?.enabled ? record.values : {};
  }

  /**
   * Estado observable: sugerencias vigentes, sin las descartadas y sin las que la
   * config **demuestra** que ya están dadas de alta.
   *
   * ⚠️ Antes se ocultaba toda sugerencia cuyo `kind` estuviera configurado, y eso
   * enterraba **el segundo aparato de un backend que ya existe**: quien conectaba
   * un Shelly no volvía a ver ninguno más. Ahora se compara aparato a aparato
   * (US-249); lo que no se puede comprobar —una cámara ONVIF, que se da de alta en
   * otra pantalla— se sigue mostrando y el usuario lo descarta, que sí se persiste.
   */
  async status(): Promise<DiscoveryStatus> {
    const [dismissed, valoresIot, valoresCamaras] = await Promise.all([
      this.dismissedIds(),
      this.valoresDe('iot'),
      this.valoresDe('cameras'),
    ]);
    const valoresDe = (domain: IntegrationDomain) =>
      domain === 'iot' ? valoresIot : domain === 'cameras' ? valoresCamaras : {};

    const suggestions = [...this.suggestions.values()]
      .filter((s) => !dismissed.has(s.id))
      .filter(
        (s) => !yaConfigurado(s.kind, s.ip, s.prefill, valoresDe(s.domain), s.domain === 'iot'),
      )
      .map((s) => ({ ...s, adoptable: this.esAdoptable(s, valoresDe(s.domain)) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      suggestions,
      scanning: this.isScanning,
      lastScanAt: this.lastScanAt ? this.lastScanAt.toISOString() : null,
    };
  }

  /** ¿Se puede dar de alta de un toque? (campos del esquema del backend). */
  private esAdoptable(s: DiscoverySuggestion, valores: IntegrationConfigValues): boolean {
    const schema = getKindSchema(s.domain, s.kind);
    if (!schema) return false;
    const prefijo = s.domain === 'iot' ? `${s.kind}.` : '';
    const guardados: IntegrationConfigValues = {};
    for (const [clave, valor] of Object.entries(valores)) {
      if (clave.startsWith(prefijo)) guardados[clave.slice(prefijo.length)] = valor;
    }
    return esAdoptable(s.prefill, schema.fields, guardados);
  }

  /**
   * Da de alta la sugerencia **reusando el camino del asistente**: funde el prefill
   * con lo ya guardado (añadir, nunca reemplazar), guarda con la semántica aditiva
   * de `iot` y recarga el manager en caliente. Devuelve `null` si la sugerencia ya
   * no existe (el barrido la retiró) y lanza si no es adoptable.
   */
  async adopt(id: string): Promise<{ domain: IntegrationDomain; kind: string } | null> {
    const suggestion = this.suggestions.get(id);
    if (!suggestion) return null;
    if (!this.store || !this.runtime) throw new Error('La adopción no está disponible');

    const valores = await this.valoresDe(suggestion.domain);
    if (!this.esAdoptable(suggestion, valores)) {
      throw new AdopcionNoPosibleError(suggestion.kind);
    }

    const esIot = suggestion.domain === 'iot';
    const config = fusionaPrefill(suggestion.kind, suggestion.prefill, valores, esIot);
    await saveDomainConfig(this.store, suggestion.domain, suggestion.kind, config, true);
    await this.runtime.reconfigure(suggestion.domain);
    return { domain: suggestion.domain, kind: suggestion.kind };
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
