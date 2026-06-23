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

describe('rutas de firewall', () => {
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
    const res = await app.inject({ method: 'GET', url: '/api/firewall/rules' });
    expect(res.statusCode).toBe(401);
  });

  it('exige rol admin (un viewer recibe 403)', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/firewall/rules',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(res.statusCode).toBe(403);
  });

  it('lista las reglas sembradas para un admin', async () => {
    const admin = await seedUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/firewall/rules',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(200);
    const rules = res.json();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThanOrEqual(1);
  });

  it('rechaza un source que no es IP/CIDR válido (400)', async () => {
    const admin = await seedUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/firewall/rules',
      headers: authHeader(signAccess(app, admin)),
      payload: { name: 'Inyección', action: 'deny', source: '1.2.3.4 -j ACCEPT' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('acepta un source IP/CIDR válido (201)', async () => {
    const admin = await seedUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/firewall/rules',
      headers: authHeader(signAccess(app, admin)),
      payload: { name: 'LAN', action: 'allow', source: '192.168.1.0/24' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().source).toBe('192.168.1.0/24');
  });

  it('crea una regla (201), la audita y aparece en el listado', async () => {
    const admin = await seedUser(app);
    const token = signAccess(app, admin);
    const res = await app.inject({
      method: 'POST',
      url: '/api/firewall/rules',
      headers: authHeader(token),
      payload: { name: 'Bloquear cámara', action: 'deny', protocol: 'tcp', port: 554 },
    });
    expect(res.statusCode).toBe(201);
    const rule = res.json();
    expect(rule.name).toBe('Bloquear cámara');
    expect(rule.action).toBe('deny');
    expect(rule.port).toBe(554);
    expect(rule.enabled).toBe(true);

    await eventually(async () => {
      // Filtra por detail: la auditoría es fire-and-forget y otra prueba del fichero
      // también crea 'firewall.rule.add', cuya escritura podría caer tras el resetDb.
      const log = await app.prisma.auditLog.findFirst({
        where: { action: 'firewall.rule.add', detail: 'Bloquear cámara' },
      });
      expect(log).not.toBeNull();
    });
  });

  it('actualiza una regla y devuelve 404 si no existe', async () => {
    const admin = await seedUser(app);
    const token = signAccess(app, admin);
    const created = await app.inject({
      method: 'POST',
      url: '/api/firewall/rules',
      headers: authHeader(token),
      payload: { name: 'tmp', action: 'allow' },
    });
    const id = created.json().id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/firewall/rules/${id}`,
      headers: authHeader(token),
      payload: { enabled: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().enabled).toBe(false);

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/firewall/rules/inexistente',
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
      url: '/api/firewall/rules',
      headers: authHeader(token),
      payload: { name: 'tmp', action: 'deny' },
    });
    const id = created.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/firewall/rules/${id}`,
      headers: authHeader(token),
    });
    expect(del.statusCode).toBe(204);

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/firewall/rules/${id}`,
      headers: authHeader(token),
    });
    expect(again.statusCode).toBe(404);
  });

  it('rechaza payloads inválidos con 400', async () => {
    const admin = await seedUser(app);
    const token = signAccess(app, admin);

    // Falta `action`.
    const noAction = await app.inject({
      method: 'POST',
      url: '/api/firewall/rules',
      headers: authHeader(token),
      payload: { name: 'x' },
    });
    expect(noAction.statusCode).toBe(400);

    // Acción fuera del enum.
    const badAction = await app.inject({
      method: 'POST',
      url: '/api/firewall/rules',
      headers: authHeader(token),
      payload: { name: 'x', action: 'drop' },
    });
    expect(badAction.statusCode).toBe(400);

    // Puerto fuera de rango.
    const badPort = await app.inject({
      method: 'POST',
      url: '/api/firewall/rules',
      headers: authHeader(token),
      payload: { name: 'x', action: 'deny', port: 70000 },
    });
    expect(badPort.statusCode).toBe(400);
  });
});
