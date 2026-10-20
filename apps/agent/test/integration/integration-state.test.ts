import { DOMAIN_STATES } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INTEGRATION_DOMAINS } from '../../src/integrations/schema.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

interface DomainView {
  domain: string;
  source: string;
  effectiveKind: string;
  state: string;
  current: { kind: string; enabled: boolean } | null;
}

/**
 * Estado de cada dominio (`configured | demo | not-configured`) y qué tiene VIVO cada uno.
 * El entorno de los tests es `mock` (default de `env.ts`), así que aquí todo es `demo`; el
 * `none` de verdad se ejercita en `not-configured-env.test.ts` con el entorno que escribe
 * `install.sh`.
 */
describe('/api/integrations — estado de los dominios', () => {
  let app: FastifyInstance;
  let adminToken: string;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    for (const role of ['admin', 'member', 'viewer', 'kid', 'guest'] as const) {
      const u = await seedUser(app, { email: `${role}@krakenos.test`, role });
      tokens[role] = signAccess(app, u);
    }
    adminToken = tokens.admin!;
  });

  const overview = async (): Promise<DomainView[]> => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations',
      headers: authHeader(adminToken),
    });
    return (res.json() as { domains: DomainView[] }).domains;
  };
  const status = async (token: string) =>
    app.inject({ method: 'GET', url: '/api/integrations/status', headers: authHeader(token) });
  const put = (domain: string, payload: object) =>
    app.inject({
      method: 'PUT',
      url: `/api/integrations/${domain}`,
      headers: authHeader(adminToken),
      payload,
    });

  describe('GET /status — lectura mínima para TODOS los roles', () => {
    it.each(['admin', 'member', 'viewer', 'kid', 'guest'])(
      '%s recibe los ocho estados',
      async (role) => {
        const res = await status(tokens[role]!);
        expect(res.statusCode).toBe(200);
        const { states } = res.json() as { states: Record<string, string> };
        // Las claves son EXACTAMENTE las de los ocho dominios (additionalProperties:false poda).
        expect(Object.keys(states).sort()).toEqual([...INTEGRATION_DOMAINS].sort());
        for (const state of Object.values(states)) expect(DOMAIN_STATES).toContain(state);
      },
    );

    it('sin token → 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/integrations/status' });
      expect(res.statusCode).toBe(401);
    });

    it('no lleva nada más que el estado (ni catálogo, ni config, ni kinds)', async () => {
      const body = (await status(tokens.viewer!)).json() as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['states']);
    });

    it('con el entorno de los tests (mock) todo es demo', async () => {
      const { states } = (await status(tokens.viewer!)).json() as {
        states: Record<string, string>;
      };
      expect(new Set(Object.values(states))).toEqual(new Set(['demo']));
    });

    it('guardar una integración real la pasa a configured, y borrarla vuelve a demo', async () => {
      const res = await put('dns', { kind: 'pihole', config: { baseUrl: 'http://192.168.1.10' } });
      expect(res.statusCode).toBe(200);
      const after = (await status(tokens.viewer!)).json() as { states: Record<string, string> };
      expect(after.states.dns).toBe('configured');
      expect(after.states.driver).toBe('demo'); // los demás no se tocan

      await app.inject({
        method: 'DELETE',
        url: '/api/integrations/dns',
        headers: authHeader(adminToken),
      });
      const back = (await status(tokens.viewer!)).json() as { states: Record<string, string> };
      expect(back.states.dns).toBe('demo');
    });
  });

  describe('GET / — `source` y `effectiveKind` dicen lo que está VIVO', () => {
    it('cada dominio lleva su estado', async () => {
      for (const d of await overview()) expect(DOMAIN_STATES).toContain(d.state);
    });

    it('una config guardada pero DESACTIVADA no es la efectiva: source env y el kind de .env', async () => {
      // Antes: `source: current ? 'db' : 'env'` y `effectiveKind: current?.kind`, así que el
      // panel decía «openwrt, desde la base de datos» mientras operaba el mock de `.env`.
      const saved = await put('driver', {
        kind: 'openwrt',
        enabled: false,
        config: { host: '192.168.1.1', username: 'root', password: 'x', sshPort: 22 },
      });
      expect(saved.statusCode).toBe(200);

      const driver = (await overview()).find((d) => d.domain === 'driver')!;
      expect(driver.current).toMatchObject({ kind: 'openwrt', enabled: false }); // sigue guardada
      expect(driver.source).toBe('env');
      expect(driver.effectiveKind).toBe('mock');
      expect(driver.state).toBe('demo');
    });

    it('una config guardada y activa SÍ es la efectiva', async () => {
      await put('driver', {
        kind: 'openwrt',
        config: { host: '192.168.1.1', username: 'root', password: 'x', sshPort: 22 },
      });
      const driver = (await overview()).find((d) => d.domain === 'driver')!;
      expect(driver.source).toBe('db');
      expect(driver.effectiveKind).toBe('openwrt');
      expect(driver.state).toBe('configured');
    });

    it('una config guardada que no se puede aplicar (fallback) deja source env', async () => {
      // `pihole` sin `baseUrl` válido no rompe la factory; un dominio que sí lanza al
      // construir es VLAN por switch sin host.
      const res = await put('vlan', { kind: 'switch', config: { host: '' } });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { fallback: boolean }).fallback).toBe(true);

      const vlan = (await overview()).find((d) => d.domain === 'vlan')!;
      expect(vlan.source).toBe('env');
      expect(vlan.effectiveKind).toBe('mock');
    });

    it('`none` no se puede guardar desde la UI: se vuelve a «sin configurar» borrando', async () => {
      const res = await put('driver', { kind: 'none', config: {} });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { code: string }).code).toBe('UNKNOWN_KIND');
    });
  });
});
