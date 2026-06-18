import type { BlockedDomain, DnsManager, DnsQuery, DnsStats } from '@krakenos/types';
import { DnsError } from './mock.dns.js';
import {
  parseAddedDomain,
  parseDenyExactList,
  parseQueries,
  parseSummary,
} from './pihole.helpers.js';

/** Respuesta HTTP mínima que necesita el manager (subconjunto de `fetch`). */
export interface HttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Función de transporte HTTP; inyectable para tests (por defecto `fetch` global). */
export type HttpFetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

const defaultFetch: HttpFetch = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, ok: res.ok, json: () => res.json(), text: () => res.text() };
};

export interface PiholeOptions {
  /** URL base de Pi-hole, p. ej. `http://pi.hole` o `http://10.0.0.2`. */
  baseUrl: string;
  /** Contraseña de la web/app de Pi-hole; vacía si no está configurada. */
  password?: string;
  /** Transporte HTTP; inyectable para tests. */
  fetch?: HttpFetch;
}

/** Cabecera con la que Pi-hole v6 autentica las peticiones tras `/api/auth`. */
const SID_HEADER = 'X-FTL-SID';

/**
 * Gestor de DNS real sobre la **API REST de Pi-hole (v6)**. Autentica con la
 * contraseña para obtener un SID de sesión y lo adjunta en cada petición,
 * renovándolo si caduca (401). La blocklist se opera contra los dominios
 * `deny`/`exact`; las estadísticas y consultas se leen de los endpoints de Pi-hole.
 *
 * No usa el helper privilegiado (US-18/19/20): Pi-hole se administra por HTTP,
 * no por comandos del sistema. El transporte es inyectable para testear el
 * contrato sin un Pi-hole real.
 */
export class PiholeDnsManager implements DnsManager {
  readonly kind = 'pihole' as const;
  private readonly baseUrl: string;
  private readonly fetch: HttpFetch;
  private sid: string | null = null;

  constructor(private readonly opts: PiholeOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetch = opts.fetch ?? defaultFetch;
  }

  /** Obtiene un SID nuevo autenticando con la contraseña. */
  private async authenticate(): Promise<void> {
    const res = await this.fetch(`${this.baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: this.opts.password ?? '' }),
    });
    if (!res.ok) {
      throw new DnsError('PIHOLE_AUTH_FAILED', `Autenticación con Pi-hole falló (${res.status})`);
    }
    const body = (await res.json()) as { session?: { valid?: boolean; sid?: string } };
    const sid = body.session?.sid;
    if (!body.session?.valid || !sid) {
      throw new DnsError('PIHOLE_AUTH_FAILED', 'Pi-hole no devolvió una sesión válida');
    }
    this.sid = sid;
  }

  /**
   * Realiza una petición autenticada. Si no hay SID, autentica primero; si la
   * sesión caducó (401), reautentica una vez y reintenta.
   */
  private async request(path: string, init: HttpRequestInit = {}): Promise<HttpResponse> {
    if (!this.sid) await this.authenticate();
    const send = () =>
      this.fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, [SID_HEADER]: this.sid ?? '' },
      });
    let res = await send();
    if (res.status === 401) {
      await this.authenticate();
      res = await send();
    }
    return res;
  }

  /** Lanza un `DnsError` con el cuerpo de la respuesta si no fue satisfactoria. */
  private async ensureOk(res: HttpResponse, context: string): Promise<void> {
    if (res.ok) return;
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new DnsError('PIHOLE_REQUEST_FAILED', `${context} (${res.status}) ${detail}`.trim());
  }

  async getStats(): Promise<DnsStats> {
    const res = await this.request('/api/stats/summary');
    await this.ensureOk(res, 'No se pudieron leer las estadísticas de Pi-hole');
    return parseSummary(await res.json());
  }

  async listBlocked(): Promise<BlockedDomain[]> {
    const res = await this.request('/api/domains/deny/exact');
    await this.ensureOk(res, 'No se pudo leer la blocklist de Pi-hole');
    return parseDenyExactList(await res.json());
  }

  async addBlocked(domain: string): Promise<BlockedDomain> {
    const normalized = domain.trim().toLowerCase();
    const existing = await this.listBlocked();
    if (existing.some((d) => d.domain === normalized)) {
      throw new DnsError('DOMAIN_EXISTS', `El dominio ${normalized} ya está bloqueado`);
    }
    const res = await this.request('/api/domains/deny/exact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: normalized }),
    });
    await this.ensureOk(res, 'No se pudo añadir el dominio a Pi-hole');
    return parseAddedDomain(await res.json(), normalized);
  }

  async removeBlocked(id: string): Promise<boolean> {
    // `id` es el propio dominio (ver `parseDenyExactList`). Pi-hole borra por dominio.
    const res = await this.request(`/api/domains/deny/exact/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.status === 404) return false;
    await this.ensureOk(res, 'No se pudo quitar el dominio de Pi-hole');
    return true;
  }

  async recentQueries(limit = 50): Promise<DnsQuery[]> {
    const res = await this.request(`/api/queries?length=${limit}`);
    await this.ensureOk(res, 'No se pudieron leer las consultas de Pi-hole');
    return parseQueries(await res.json(), limit);
  }
}
