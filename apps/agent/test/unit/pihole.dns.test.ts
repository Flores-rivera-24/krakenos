import { beforeEach, describe, expect, it } from 'vitest';
import { DnsError } from '../../src/dns/mock.dns.js';
import type { HttpFetch, HttpRequestInit, HttpResponse } from '../../src/dns/pihole.dns.js';
import { PiholeDnsManager } from '../../src/dns/pihole.dns.js';

interface Call {
  method: string;
  path: string;
  body?: unknown;
  sid?: string;
}

type Handler = (call: Call) => Partial<HttpResponse> & { status: number; json?: unknown };

/** `fetch` falso: registra llamadas y responde por `${METHOD} ${path}`. */
class FakeFetch {
  calls: Call[] = [];
  private handlers = new Map<string, Handler>();
  /** Nº de veces que se pedirá 401 antes de aceptar (para probar la reautenticación). */
  expireOnce = false;
  private expired = false;

  on(key: string, handler: Handler): this {
    this.handlers.set(key, handler);
    return this;
  }

  readonly fetch: HttpFetch = async (url: string, init: HttpRequestInit = {}) => {
    const path = url.replace('http://pi.hole', '');
    const method = init.method ?? 'GET';
    const sid = init.headers?.['X-FTL-SID'];
    const body = init.body ? JSON.parse(init.body) : undefined;
    this.calls.push({ method, path: path.split('?')[0]!, body, sid });

    // Simula una sesión caducada la primera vez que se usa un SID.
    if (this.expireOnce && !this.expired && sid && path !== '/api/auth') {
      this.expired = true;
      return this.make({ status: 401 });
    }

    const key = `${method} ${path.split('?')[0]}`;
    const handler = this.handlers.get(key);
    if (!handler) throw new Error(`Sin handler para ${key}`);
    return this.make(handler({ method, path, body, sid }));
  };

  private make(r: Partial<HttpResponse> & { status: number; json?: unknown }): HttpResponse {
    return {
      status: r.status,
      ok: r.ok ?? (r.status >= 200 && r.status < 300),
      json: async () => r.json,
      text: async () => (typeof r.json === 'string' ? r.json : JSON.stringify(r.json ?? '')),
    };
  }
}

function withAuth(fake: FakeFetch): FakeFetch {
  return fake.on('POST /api/auth', () => ({
    status: 200,
    json: { session: { valid: true, sid: 'SID123' } },
  }));
}

function makeManager(fake: FakeFetch, password = 'secret') {
  return new PiholeDnsManager({ baseUrl: 'http://pi.hole', password, fetch: fake.fetch });
}

describe('PiholeDnsManager', () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = withAuth(new FakeFetch());
  });

  it('autentica una vez y adjunta el SID en las peticiones siguientes', async () => {
    fake.on('GET /api/stats/summary', () => ({
      status: 200,
      json: { queries: { total: 100, blocked: 10, percent_blocked: 10 }, gravity: { domains_being_blocked: 500 } },
    }));
    const dns = makeManager(fake);

    const stats = await dns.getStats();
    expect(stats).toEqual({ totalQueries: 100, blockedQueries: 10, blockedPercent: 10, blocklistSize: 500 });
    // La primera llamada autentica con la contraseña; la segunda lleva el SID.
    expect(fake.calls[0]).toMatchObject({ path: '/api/auth', body: { password: 'secret' } });
    expect(fake.calls[1]).toMatchObject({ path: '/api/stats/summary', sid: 'SID123' });

    // Una segunda operación reusa el SID sin volver a autenticar.
    await dns.getStats();
    expect(fake.calls.filter((c) => c.path === '/api/auth')).toHaveLength(1);
  });

  it('reautentica y reintenta cuando la sesión caduca (401)', async () => {
    fake.expireOnce = true;
    fake.on('GET /api/stats/summary', () => ({
      status: 200,
      json: { queries: { total: 1, blocked: 0 }, gravity: {} },
    }));
    const dns = makeManager(fake);

    await dns.getStats();
    expect(fake.calls.filter((c) => c.path === '/api/auth')).toHaveLength(2);
    expect(fake.calls.filter((c) => c.path === '/api/stats/summary')).toHaveLength(2);
  });

  it('lanza si la autenticación falla', async () => {
    const bad = new FakeFetch().on('POST /api/auth', () => ({ status: 401, json: { session: { valid: false } } }));
    await expect(makeManager(bad).getStats()).rejects.toBeInstanceOf(DnsError);
  });

  it('lista la blocklist (deny/exact) con el dominio como id', async () => {
    fake.on('GET /api/domains/deny/exact', () => ({
      status: 200,
      json: { domains: [{ domain: 'ads.bad.com', date_added: 1700000000 }] },
    }));
    const list = await makeManager(fake).listBlocked();
    expect(list).toEqual([
      { id: 'ads.bad.com', domain: 'ads.bad.com', createdAt: new Date(1700000000 * 1000).toISOString() },
    ]);
  });

  it('añade un dominio normalizado vía POST deny/exact', async () => {
    fake
      .on('GET /api/domains/deny/exact', () => ({ status: 200, json: { domains: [] } }))
      .on('POST /api/domains/deny/exact', (c) => ({
        status: 201,
        json: { domains: [{ domain: (c.body as { domain: string }).domain, date_added: 1700000000 }] },
      }));
    const dns = makeManager(fake);

    const entry = await dns.addBlocked('  ADS.Nuevo.COM  ');
    expect(entry.domain).toBe('ads.nuevo.com');
    const post = fake.calls.find((c) => c.method === 'POST' && c.path === '/api/domains/deny/exact');
    expect(post?.body).toEqual({ domain: 'ads.nuevo.com' });
  });

  it('rechaza un dominio ya presente sin llamar al POST', async () => {
    fake.on('GET /api/domains/deny/exact', () => ({
      status: 200,
      json: { domains: [{ domain: 'dup.com', date_added: 1 }] },
    }));
    const dns = makeManager(fake);

    await expect(dns.addBlocked('dup.com')).rejects.toMatchObject({ code: 'DOMAIN_EXISTS' });
    expect(fake.calls.some((c) => c.method === 'POST' && c.path === '/api/domains/deny/exact')).toBe(false);
  });

  it('elimina por dominio: 204 → true, 404 → false', async () => {
    fake.on('DELETE /api/domains/deny/exact/quitar.com', () => ({ status: 204 }));
    fake.on('DELETE /api/domains/deny/exact/nope.com', () => ({ status: 404 }));
    const dns = makeManager(fake);

    expect(await dns.removeBlocked('quitar.com')).toBe(true);
    expect(await dns.removeBlocked('nope.com')).toBe(false);
  });

  it('lee las consultas recientes con el límite', async () => {
    fake.on('GET /api/queries', () => ({
      status: 200,
      json: {
        queries: [
          { time: 1700000000, domain: 'ads.bad.com', client: { ip: '10.0.0.5' }, status: 'GRAVITY' },
          { time: 1700000005, domain: 'github.com', client: '10.0.0.6', status: 'FORWARDED' },
        ],
      },
    }));
    const queries = await makeManager(fake).recentQueries(10);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatchObject({ domain: 'ads.bad.com', client: '10.0.0.5', blocked: true });
  });
});
