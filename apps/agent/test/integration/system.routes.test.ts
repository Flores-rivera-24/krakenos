import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { rateLimitStore } from '../../src/plugins/rate-limit-store.js';
import { authHeader, buildTestApp, eventually, resetDb, seedUser, signAccess } from '../helpers/app.js';

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

  it('GET /api/system/info devuelve homeName sin token y OMITE version por defecto (US-83)', async () => {
    await app.prisma.setting.upsert({
      where: { key: 'homeName' },
      create: { key: 'homeName', value: 'Casa Kraken' },
      update: { value: 'Casa Kraken' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/system/info' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.homeName).toBe('Casa Kraken');
    expect(body).not.toHaveProperty('version'); // no se filtra la versión pre-auth
  });

  it('GET /api/system/info expone version solo con PUBLIC_VERSION (US-83)', async () => {
    process.env.PUBLIC_VERSION = 'true';
    try {
      const res = await app.inject({ method: 'GET', url: '/api/system/info' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.version).toBe('string');
      expect(body.version.length).toBeGreaterThan(0);
    } finally {
      delete process.env.PUBLIC_VERSION;
    }
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

  // Actualización one-click (US-190). En el entorno de test no hay UPDATE_CHECK_REPO
  // → el comprobador está desactivado; el modo autodetectado es systemd (sin
  // /.dockerenv). Verificamos auth, forma del plan y que apply no lanza nada real.
  it('GET /api/system/update/plan devuelve el plan (autenticado)', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/update/plan',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('systemd');
    expect(body.canSelfUpdate).toBe(true);
    expect(body.enabled).toBe(false); // sin repo configurado
    expect(body.inProgress).toBe(false);
    expect(body.inProgressSince).toBeNull();
    expect(body).toHaveProperty('lastResult');
  });

  it('GET /api/system/update/plan exige autenticación (401 sin token)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/update/plan' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/system/update/apply requiere admin (403 a viewer)', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/update/apply',
      headers: authHeader(signAccess(app, viewer)),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/system/update/apply (admin) no aplica si la comprobación está desactivada', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/update/apply',
      headers: authHeader(signAccess(app, admin)),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.started).toBe(false);
    expect(body.mode).toBe('systemd');
    expect(typeof body.message).toBe('string');

    // Queda auditado (el audit es fire-and-forget: se espera a que se persista).
    await eventually(async () => {
      const audit = await app.prisma.auditLog.findFirst({ where: { action: 'system.update.apply' } });
      expect(audit).not.toBeNull();
    });
  });

  // Cancelar la actualización (US-232): sin lock no hay nada que cancelar, pero la
  // ruta existe y está auditada — antes un lock huérfano solo se arreglaba por SSH.
  it('POST /api/system/update/cancel requiere admin (403 a viewer)', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/update/cancel',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/system/update/cancel (admin) sin actualización en curso responde cancelled:false y audita', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/update/cancel',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cancelled).toBe(false);
    expect(typeof res.json().message).toBe('string');

    await eventually(async () => {
      const audit = await app.prisma.auditLog.findFirst({
        where: { action: 'system.update.cancel' },
      });
      expect(audit).not.toBeNull();
    });
  });

  // Observabilidad (US-191): lectura autenticada; /health sigue mínimo.
  it('GET /api/system/metrics exige autenticación (401 sin token)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/metrics' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/system/metrics devuelve métricas reales (cualquier rol autenticado)', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const headers = authHeader(signAccess(app, viewer));
    // Genera algo de tráfico para que las métricas HTTP reflejen estado real.
    await app.inject({ method: 'GET', url: '/api/system/stats', headers });

    const res = await app.inject({ method: 'GET', url: '/api/system/metrics', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.http.total).toBeGreaterThan(0);
    expect(typeof body.memory.rssBytes).toBe('number');
    expect(typeof body.eventLoop.lagMs).toBe('number');
    expect(body.websocketClients).toBe(0);
    // La ruta muestrea el driver → aparece como manager.
    expect(body.managers.some((m: { name: string }) => m.name.startsWith('driver:'))).toBe(true);
  });

  it('/health público sigue mínimo (no filtra métricas ni uptime)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  // Telemetría opt-in (US-192): OFF por defecto, sin recuentos hasta activarla.
  it('GET /api/system/telemetry OFF por defecto (opt-in): sin recuentos', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/telemetry',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(body).not.toHaveProperty('counts'); // opt-in: nada hasta activarla
    expect(typeof body.version).toBe('string');
  });

  it('GET /api/system/telemetry con opt-in ON devuelve recuentos anónimos', async () => {
    await app.prisma.setting.upsert({
      where: { key: 'telemetryEnabled' },
      create: { key: 'telemetryEnabled', value: 'on' },
      update: { value: 'on' },
    });
    const viewer = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/telemetry',
      headers: authHeader(signAccess(app, viewer)),
    });
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.counts).toBeDefined();
    expect(typeof body.counts.devices).toBe('number');
    expect(typeof body.counts.users).toBe('number');
  });

  // Bundle de soporte (US-192): admin, auditado, SIN secretos ni PII.
  it('POST /api/system/support-bundle requiere admin (403 a viewer)', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/support-bundle',
      headers: authHeader(signAccess(app, viewer)),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/system/support-bundle (admin) no filtra secretos ni PII y queda auditado', async () => {
    // Ajustes con PII (ubicación/nombre del hogar) + una integración con secreto.
    await app.prisma.setting.createMany({
      data: [
        { key: 'homeName', value: 'Casa de Prueba' },
        { key: 'homeLatitude', value: '40.4168' },
        { key: 'homeLongitude', value: '-3.7038' },
      ],
    });
    await app.prisma.integrationConfig.create({
      data: {
        domain: 'dns',
        kind: 'pihole',
        enabled: true,
        // Un secreto (password) + un campo no secreto (baseUrl).
        config: JSON.stringify({ password: 'SUPER-SECRETO-123', baseUrl: 'http://192.168.1.2' }),
      },
    });

    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/support-bundle',
      headers: authHeader(signAccess(app, admin)),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const raw = res.body; // el JSON crudo, para buscar fugas por substring
    expect(raw).not.toContain('SUPER-SECRETO-123'); // el secreto NO aparece
    expect(raw).not.toContain('Casa de Prueba'); // el nombre del hogar (PII) NO aparece
    expect(raw).not.toContain('40.4168'); // la ubicación (PII) NO aparece

    const bundle = res.json();
    // La integración aparece pero solo con qué secretos hay puestos (no el valor).
    const dns = bundle.integrations.find((i: { domain: string }) => i.domain === 'dns');
    expect(dns.secretsSet).toContain('password');
    expect(dns.config).not.toHaveProperty('password');
    expect(dns.config.baseUrl).toBe('http://192.168.1.2'); // lo no secreto sí aparece
    // Ajustes sin claves PII.
    expect(bundle.settings).not.toHaveProperty('homeName');
    expect(bundle.settings).not.toHaveProperty('homeLatitude');
    // Trae métricas + telemetría + auditoría sin IP.
    expect(bundle.metrics).toBeDefined();
    expect(bundle.telemetry.enabled).toBe(false);
    expect(Array.isArray(bundle.recentAudit)).toBe(true);
    if (bundle.recentAudit[0]) {
      expect(bundle.recentAudit[0]).not.toHaveProperty('ip');
      expect(bundle.recentAudit[0]).toHaveProperty('action');
    }

    // `app.audit` es fire-and-forget (no bloquea la respuesta): la fila puede llegar
    // un tick después, así que se espera en vez de leer una sola vez. Misma carrera
    // latente que ya se corrigió en `system.update.apply` (US-220), que el cambio de
    // temporización de WAL (US-228) volvió a destapar aquí.
    await eventually(async () => {
      const audit = await app.prisma.auditLog.findFirst({
        where: { action: 'system.support-bundle' },
      });
      expect(audit).not.toBeNull();
    });
  });
});
