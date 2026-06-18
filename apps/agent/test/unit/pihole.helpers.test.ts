import { describe, expect, it } from 'vitest';
import {
  isBlockedStatus,
  parseAddedDomain,
  parseDenyExactList,
  parseQueries,
  parseSummary,
} from '../../src/dns/pihole.helpers.js';

describe('parseSummary', () => {
  it('mapea totales, porcentaje y tamaño de gravity', () => {
    const stats = parseSummary({
      queries: { total: 1000, blocked: 250, percent_blocked: 25 },
      gravity: { domains_being_blocked: 123456 },
    });
    expect(stats).toEqual({
      totalQueries: 1000,
      blockedQueries: 250,
      blockedPercent: 25,
      blocklistSize: 123456,
    });
  });

  it('calcula el porcentaje si Pi-hole no lo da y tolera campos ausentes', () => {
    expect(parseSummary({ queries: { total: 200, blocked: 50 } }).blockedPercent).toBe(25);
    expect(parseSummary({}).blockedPercent).toBe(0);
    expect(parseSummary(null)).toEqual({
      totalQueries: 0,
      blockedQueries: 0,
      blockedPercent: 0,
      blocklistSize: 0,
    });
  });
});

describe('parseDenyExactList', () => {
  it('usa el dominio como id, mapea la fecha y ordena alfabéticamente', () => {
    const list = parseDenyExactList({
      domains: [
        { domain: 'zeta.com', date_added: 1700000000 },
        { domain: 'alpha.com', date_added: 1700000500 },
        { type: 'deny', kind: 'exact' }, // sin domain → descartado
      ],
    });
    expect(list.map((d) => d.domain)).toEqual(['alpha.com', 'zeta.com']);
    expect(list[0]!.id).toBe('alpha.com');
    expect(list[1]!.createdAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('tolera una respuesta sin dominios', () => {
    expect(parseDenyExactList({})).toEqual([]);
    expect(parseDenyExactList(null)).toEqual([]);
  });
});

describe('parseAddedDomain', () => {
  it('toma la entrada creada de la respuesta', () => {
    const entry = parseAddedDomain({ domains: [{ domain: 'nuevo.com', date_added: 1700000000 }] }, 'nuevo.com');
    expect(entry.id).toBe('nuevo.com');
    expect(entry.createdAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('reconstruye desde el dominio solicitado si la respuesta no lo trae', () => {
    const entry = parseAddedDomain({}, 'fallback.com');
    expect(entry).toMatchObject({ id: 'fallback.com', domain: 'fallback.com' });
    expect(typeof entry.createdAt).toBe('string');
  });
});

describe('isBlockedStatus', () => {
  it('reconoce los estados bloqueados de Pi-hole', () => {
    for (const s of ['GRAVITY', 'DENYLIST', 'REGEX', 'gravity_cname', 'EXTERNAL_BLOCKED_NULL']) {
      expect(isBlockedStatus(s)).toBe(true);
    }
  });

  it('trata el resto (y valores no-string) como permitidos', () => {
    for (const s of ['OK', 'FORWARDED', 'CACHE', 'RETRIED', 2, null, undefined]) {
      expect(isBlockedStatus(s)).toBe(false);
    }
  });
});

describe('parseQueries', () => {
  const json = {
    queries: [
      { time: 1700000000, domain: 'ads.bad.com', client: { ip: '10.0.0.5', name: 'tv' }, status: 'GRAVITY' },
      { time: 1700000005, domain: 'github.com', client: '10.0.0.6', status: 'FORWARDED' },
      { time: 1700000010, status: 'OK' }, // sin domain → descartado
    ],
  };

  it('mapea timestamp/cliente/bloqueo y soporta cliente string u objeto', () => {
    const queries = parseQueries(json);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toEqual({
      timestamp: new Date(1700000000 * 1000).toISOString(),
      domain: 'ads.bad.com',
      client: '10.0.0.5',
      blocked: true,
    });
    expect(queries[1]).toMatchObject({ client: '10.0.0.6', blocked: false });
  });

  it('respeta el límite', () => {
    expect(parseQueries(json, 1)).toHaveLength(1);
    expect(parseQueries({}, 5)).toEqual([]);
  });
});
