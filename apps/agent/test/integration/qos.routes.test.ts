import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeader,
  buildTestApp,
  eventually,
  resetDb,
  seedUser,
  signAccess,
} from '../helpers/app.js';

describe('rutas de QoS', () => {
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
    const res = await app.inject({ method: 'GET', url: '/api/qos/rules' });
    expect(res.statusCode).toBe(401);
  });

  it('exige rol admin (un viewer recibe 403)', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/qos/rules',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(res.statusCode).toBe(403);
  });

  it('lista las reglas sembradas para un admin', async () => {
    const admin = await seedUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/qos/rules',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json().length).toBeGreaterThanOrEqual(1);
  });

  it('crea una regla (201), la audita y aplica valores por defecto', async () => {
    const admin = await seedUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/qos/rules',
      headers: authHeader(signAccess(app, admin)),
      payload: { name: 'Prioridad trabajo', target: '10.0.0.20', priority: 'high' },
    });
    expect(res.statusCode).toBe(201);
    const rule = res.json();
    expect(rule.priority).toBe('high');
    expect(rule.downloadKbps).toBe(0);
    expect(rule.enabled).toBe(true);

    await eventually(async () => {
      const log = await app.prisma.auditLog.findFirst({ where: { action: 'qos.rule.add' } });
      expect(log?.detail).toBe('Prioridad trabajo');
    });
  });

  it('actualiza una regla y 404 si no existe', async () => {
    const admin = await seedUser(app);
    const token = signAccess(app, admin);
    const created = await app.inject({
      method: 'POST',
      url: '/api/qos/rules',
      headers: authHeader(token),
      payload: { name: 'tmp', target: 'x' },
    });
    const id = created.json().id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/qos/rules/${id}`,
      headers: authHeader(token),
      payload: { enabled: false, downloadKbps: 10_000 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().enabled).toBe(false);
    expect(patched.json().downloadKbps).toBe(10_000);

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/qos/rules/inexistente',
      headers: authHeader(token),
      payload: { enabled: true },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('elimina una regla (204) y 404 si ya no existe', async () => {
    const admin = await seedUser(app);
    const token = signAccess(app, admin);
    const created = await app.inject({
      method: 'POST',
      url: '/api/qos/rules',
      headers: authHeader(token),
      payload: { name: 'tmp', target: 'x' },
    });
    const id = created.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/qos/rules/${id}`,
      headers: authHeader(token),
    });
    expect(del.statusCode).toBe(204);

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/qos/rules/${id}`,
      headers: authHeader(token),
    });
    expect(again.statusCode).toBe(404);
  });

  it('rechaza payloads inválidos con 400', async () => {
    const admin = await seedUser(app);
    const token = signAccess(app, admin);

    // Falta `target`.
    const noTarget = await app.inject({
      method: 'POST',
      url: '/api/qos/rules',
      headers: authHeader(token),
      payload: { name: 'x' },
    });
    expect(noTarget.statusCode).toBe(400);

    // Prioridad fuera del enum.
    const badPriority = await app.inject({
      method: 'POST',
      url: '/api/qos/rules',
      headers: authHeader(token),
      payload: { name: 'x', target: 'y', priority: 'urgent' },
    });
    expect(badPriority.statusCode).toBe(400);

    // Límite negativo.
    const badLimit = await app.inject({
      method: 'POST',
      url: '/api/qos/rules',
      headers: authHeader(token),
      payload: { name: 'x', target: 'y', downloadKbps: -1 },
    });
    expect(badLimit.statusCode).toBe(400);
  });
});
