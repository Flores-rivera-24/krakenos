import { vi } from 'vitest';

// El entorno que escribe `install.sh` en una instalación real: los ocho dominios en `none`.
// Va en `vi.hoisted` porque `config/env.ts` lee `process.env` al importarse.
vi.hoisted(() => {
  for (const k of [
    'DRIVER_KIND',
    'VPN_KIND',
    'IOT_KIND',
    'CAMERAS_KIND',
    'FIREWALL_KIND',
    'VLAN_KIND',
    'QOS_KIND',
    'DNS_KIND',
  ]) {
    process.env[k] = 'none';
  }
});

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSecretbox, generateSecretboxKey } from '../../src/config/secretbox.js';
import { IntegrationConfigStore } from '../../src/integrations/integration-config.store.js';
import { buildIntegrationRuntime } from '../../src/integrations/runtime.js';
import { INTEGRATION_DOMAINS } from '../../src/integrations/schema.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('entorno de una instalación nueva (`*_KIND=none`)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
  });

  it('el runtime arranca los ocho dominios sin configurar, con managers `none` (ningún mock)', async () => {
    const store = new IntegrationConfigStore(app.prisma, createSecretbox(generateSecretboxKey()));
    const rt = await buildIntegrationRuntime(app, store);

    expect(Object.keys(rt.states()).sort()).toEqual([...INTEGRATION_DOMAINS].sort());
    for (const domain of INTEGRATION_DOMAINS) {
      expect(rt.states()[domain], domain).toBe('not-configured');
      expect(rt.live(domain), domain).toEqual({ kind: 'none', source: 'env' });
    }
    for (const holder of [
      rt.driver,
      rt.vpn,
      rt.iot,
      rt.cameras,
      rt.firewall,
      rt.vlan,
      rt.qos,
      rt.dns,
    ]) {
      expect((holder.handle as { notConfigured?: boolean }).notConfigured).toBe(true);
      expect((holder.current as { kind?: string }).kind).toBe('none');
    }
  });

  it('lo que el agente enseña con ese entorno está vacío: nada inventado', async () => {
    const store = new IntegrationConfigStore(app.prisma, createSecretbox(generateSecretboxKey()));
    const rt = await buildIntegrationRuntime(app, store);

    await expect(rt.driver.handle.scanArp()).resolves.toEqual([]);
    await expect(rt.driver.handle.scanMdns()).resolves.toEqual([]);
    await expect(rt.driver.handle.listAccessPoints()).resolves.toEqual([]);
    await expect(rt.iot.handle.listDevices()).resolves.toEqual([]);
    await expect(rt.cameras.handle.listCameras()).resolves.toEqual([]);
    await expect(rt.firewall.handle.listRules()).resolves.toEqual([]);
    await expect(rt.qos.handle.listRules()).resolves.toEqual([]);
    await expect(rt.vlan.handle.listVlans()).resolves.toEqual([]);
    await expect(rt.vpn.handle.listPeers()).resolves.toEqual([]);
    await expect(rt.dns.handle.listBlocked()).resolves.toEqual([]);
  });

  it('GET /api/integrations/status lo dice a cualquier rol, y el overview trae `none` como kind efectivo', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const admin = await seedUser(app, { email: 'a@krakenos.test', role: 'admin' });

    const status = await app.inject({
      method: 'GET',
      url: '/api/integrations/status',
      headers: authHeader(signAccess(app, viewer)),
    });
    const { states } = status.json() as { states: Record<string, string> };
    expect(new Set(Object.values(states))).toEqual(new Set(['not-configured']));

    const overview = await app.inject({
      method: 'GET',
      url: '/api/integrations',
      headers: authHeader(signAccess(app, admin)),
    });
    const domains = (overview.json() as { domains: { effectiveKind: string; state: string }[] })
      .domains;
    expect(domains).toHaveLength(INTEGRATION_DOMAINS.length);
    for (const d of domains) {
      expect(d.effectiveKind).toBe('none');
      expect(d.state).toBe('not-configured');
    }
  });

  it('conectar un dominio lo saca de «sin configurar» sin tocar los demás', async () => {
    const admin = await seedUser(app, { email: 'a2@krakenos.test', role: 'admin' });
    const token = signAccess(app, admin);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/integrations/dns',
      headers: authHeader(token),
      payload: { kind: 'pihole', config: { baseUrl: 'http://192.168.1.10' } },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations/status',
      headers: authHeader(token),
    });
    const { states } = res.json() as { states: Record<string, string> };
    expect(states.dns).toBe('configured');
    expect(states.driver).toBe('not-configured');

    // Y borrar la config vuelve a `.env`, que es `none` (no a un mock inventado).
    await app.inject({
      method: 'DELETE',
      url: '/api/integrations/dns',
      headers: authHeader(token),
    });
    const back = await app.inject({
      method: 'GET',
      url: '/api/integrations/status',
      headers: authHeader(token),
    });
    expect((back.json() as { states: Record<string, string> }).states.dns).toBe('not-configured');
  });
});
