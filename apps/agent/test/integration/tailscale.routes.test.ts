import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

const RUNNING = JSON.stringify({
  Version: '1.66.4',
  BackendState: 'Running',
  Self: { DNSName: 'krakenos.tail1234.ts.net.', TailscaleIPs: ['100.101.102.103'] },
});

describe('GET /api/vpn/tailscale (US-215)', () => {
  describe('con el socket ausente (default del helper)', () => {
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

    it('exige autenticación', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/vpn/tailscale' });
      expect(res.statusCode).toBe(401);
    });

    it('exige rol admin (un viewer recibe 403)', async () => {
      const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/vpn/tailscale',
        headers: authHeader(signAccess(app, viewer)),
      });
      expect(res.statusCode).toBe(403);
    });

    it('sin tailscaled → not-installed con nulls (nunca 500)', async () => {
      const admin = await seedUser(app, { role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/vpn/tailscale',
        headers: authHeader(signAccess(app, admin)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        state: 'not-installed',
        tailscaleIp: null,
        magicDnsName: null,
        version: null,
      });
    });
  });

  it('con tailscaled activo → running con IP y MagicDNS', async () => {
    const app = await buildTestApp({
      routes: true,
      tailscale: { fetchStatus: () => Promise.resolve(RUNNING) },
    });
    try {
      await resetDb(app);
      const admin = await seedUser(app, { role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/vpn/tailscale',
        headers: authHeader(signAccess(app, admin)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        state: 'running',
        tailscaleIp: '100.101.102.103',
        magicDnsName: 'krakenos.tail1234.ts.net',
        version: '1.66.4',
      });
    } finally {
      await app.close();
    }
  });

  it('daemon instalado pero sin responder → stopped', async () => {
    const app = await buildTestApp({
      routes: true,
      tailscale: {
        fetchStatus: () =>
          Promise.reject(Object.assign(new Error('conn refused'), { code: 'ECONNREFUSED' })),
      },
    });
    try {
      await resetDb(app);
      const admin = await seedUser(app, { role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/vpn/tailscale',
        headers: authHeader(signAccess(app, admin)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: 'stopped', magicDnsName: null });
    } finally {
      await app.close();
    }
  });
});
