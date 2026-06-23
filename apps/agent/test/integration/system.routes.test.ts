import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { rateLimitStore } from '../../src/plugins/rate-limit-store.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas de sistema', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    rateLimitStore.reset();
  });

  it('GET /api/system/info devuelve homeName y version sin token (US-49)', async () => {
    await app.prisma.setting.upsert({
      where: { key: 'homeName' },
      create: { key: 'homeName', value: 'Casa Kraken' },
      update: { value: 'Casa Kraken' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/system/info' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.homeName).toBe('Casa Kraken');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });

  it('GET /api/system/stats exige autenticación (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/system/stats devuelve estadísticas con forma válida', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/stats',
      headers: authHeader(signAccess(app, user)),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.cpu.cores).toBeGreaterThanOrEqual(1);
    expect(body.cpu.loadPercent).toBeGreaterThanOrEqual(0);
    expect(body.cpu.loadPercent).toBeLessThanOrEqual(100);
    expect(body.memory.totalBytes).toBeGreaterThan(0);
    expect(body.memory.usedBytes).toBeGreaterThanOrEqual(0);
    expect(body.memory.usedPercent).toBeGreaterThanOrEqual(0);
    expect(body.memory.usedPercent).toBeLessThanOrEqual(100);
    expect(typeof body.timestamp).toBe('string');
  });

  it('GET /api/system/settings devuelve ajustes (con defaults) + info', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settings.scanIntervalSec).toBe('60'); // default
    expect(body.info.driver).toBe('mock');
    expect(typeof body.info.httpsEnabled).toBe('boolean');
  });

  it('PATCH /api/system/settings persiste y devuelve la setting actualizada (admin)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, admin)),
      payload: { key: 'timezone', value: 'Europe/Madrid' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.timezone).toBe('Europe/Madrid');
  });

  it('PATCH scanIntervalSec reprograma el barrido en caliente (US-47)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const spy = vi.spyOn(InventoryService.prototype, 'setScanInterval');
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/system/settings',
        headers: authHeader(signAccess(app, admin)),
        payload: { key: 'scanIntervalSec', value: '30' },
      });
      expect(res.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledWith(30_000); // 30 s → ms
      expect(res.json().appliedImmediately).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('PATCH loginRateLimit actualiza el rate-limit-store en caliente (US-47)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, admin)),
      payload: { key: 'loginRateLimit', value: '20' },
    });
    expect(res.statusCode).toBe(200);
    expect(rateLimitStore.getCurrent()).toBe(20);
    expect(res.json().appliedImmediately).toBe(true);
  });

  it('PATCH acota accessTokenTtl a su rango permitido (US-75, F5)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const huge = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, admin)),
      payload: { key: 'accessTokenTtl', value: '100000' },
    });
    expect(huge.statusCode).toBe(200);
    expect(huge.json().settings.accessTokenTtl).toBe('3600'); // máx 1 h

    const tiny = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, admin)),
      payload: { key: 'accessTokenTtl', value: '5' },
    });
    expect(tiny.json().settings.accessTokenTtl).toBe('60'); // mín
  });

  it('PATCH acota loginRateLimit y aplica el valor acotado en caliente (US-75, F5)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, admin)),
      payload: { key: 'loginRateLimit', value: '99999' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.loginRateLimit).toBe('1000'); // máx
    expect(rateLimitStore.getCurrent()).toBe(1000); // el caliente también acotado
  });

  it('el TTL del access token emitido en login respeta la cota aunque la setting sea enorme', async () => {
    const admin = await seedUser(app, {
      email: 'ttl@krakenos.test',
      password: 'password123',
      role: 'admin',
    });
    await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, admin)),
      payload: { key: 'accessTokenTtl', value: '999999' },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ttl@krakenos.test', password: 'password123' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().tokens.expiresIn).toBe(3600); // acotado, no 999999
  });

  it('PATCH marca appliedImmediately solo para ajustes en caliente (US-47)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, admin)),
      payload: { key: 'timezone', value: 'UTC' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().appliedImmediately).toBe(false);
  });

  it('PATCH /api/system/settings rechaza claves fuera de la allowlist (400)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, admin)),
      payload: { key: 'passwordHash', value: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /api/system/settings requiere rol admin (403 a viewer)', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: authHeader(signAccess(app, viewer)),
      payload: { key: 'timezone', value: 'UTC' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/system/connectivity-test devuelve ok con el driver mock (admin)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/connectivity-test',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.latencyMs).toBe('number');
  });

  it('POST /api/system/regen-keys revoca todas las sesiones (admin)', async () => {
    const admin = await seedUser(app, { email: 'rk@krakenos.test', password: 'password123', role: 'admin' });
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'rk@krakenos.test', password: 'password123' } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/system/regen-keys',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(204);

    const active = await app.prisma.refreshToken.count({ where: { revoked: false } });
    expect(active).toBe(0);
  });
});
