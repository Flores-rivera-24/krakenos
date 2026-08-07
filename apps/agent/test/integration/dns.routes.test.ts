import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeader,
  buildTestApp,
  resetDb,
  seedUser,
  signAccess,
} from '../helpers/app.js';
import { esperarUnaAuditoria } from '../helpers/audit.js';

describe('rutas de DNS', () => {
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
    const res = await app.inject({ method: 'GET', url: '/api/dns/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('un viewer ve stats y blocklist, pero NO las consultas ni bloquea (US-250)', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const token = signAccess(app, viewer);

    const stats = await app.inject({ method: 'GET', url: '/api/dns/stats', headers: authHeader(token) });
    expect(stats.statusCode).toBe(200);
    expect(typeof stats.json().blockedPercent).toBe('number');

    const list = await app.inject({ method: 'GET', url: '/api/dns/blocklist', headers: authHeader(token) });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json())).toBe(true);

    // El registro de consultas es el historial de navegación del hogar: sale de
    // «lectura autenticada» y pasa a `home.activity` (US-250). Antes daba 200.
    const queries = await app.inject({ method: 'GET', url: '/api/dns/queries', headers: authHeader(token) });
    expect(queries.statusCode).toBe(403);

    const add = await app.inject({
      method: 'POST',
      url: '/api/dns/blocklist',
      headers: authHeader(token),
      payload: { domain: 'nope.example.com' },
    });
    expect(add.statusCode).toBe(403);
  });

  it('un admin sí lee el registro de consultas (US-250)', async () => {
    const admin = await seedUser(app, { email: 'a@dnsq.test' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/dns/queries',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('admin bloquea un dominio (201), lo audita, y rechaza duplicados (409)', async () => {
    const admin = await seedUser(app);
    const token = signAccess(app, admin);

    const res = await app.inject({
      method: 'POST',
      url: '/api/dns/blocklist',
      headers: authHeader(token),
      payload: { domain: 'malware.example.com' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().domain).toBe('malware.example.com');

    // Filtra por detail (auditoría fire-and-forget; otras pruebas crean 'dns.block.add').
    await esperarUnaAuditoria(app, { action: 'dns.block.add', detail: 'malware.example.com' });

    const dup = await app.inject({
      method: 'POST',
      url: '/api/dns/blocklist',
      headers: authHeader(token),
      payload: { domain: 'malware.example.com' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('rechaza un dominio inválido (400)', async () => {
    const admin = await seedUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/dns/blocklist',
      headers: authHeader(signAccess(app, admin)),
      payload: { domain: 'no es un dominio' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('elimina un dominio (204) y 404 si no existe', async () => {
    const admin = await seedUser(app);
    const token = signAccess(app, admin);
    const created = await app.inject({
      method: 'POST',
      url: '/api/dns/blocklist',
      headers: authHeader(token),
      payload: { domain: 'borrar.example.com' },
    });
    const id = created.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/dns/blocklist/${id}`,
      headers: authHeader(token),
    });
    expect(del.statusCode).toBe(204);

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/dns/blocklist/${id}`,
      headers: authHeader(token),
    });
    expect(again.statusCode).toBe(404);
  });
});
