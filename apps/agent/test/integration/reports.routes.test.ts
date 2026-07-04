import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Informes CSV (US-109): lectura autenticada; exportan datos reales. */
describe('informes CSV (US-109)', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    token = signAccess(app, await seedUser(app, { role: 'viewer' }));
  });

  it('exige token (401 sin él)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/devices.csv' });
    expect(res.statusCode).toBe(401);
  });

  it('exporta el inventario como CSV', async () => {
    await app.prisma.device.create({ data: { mac: 'aa:bb:cc:00:11:22', ip: '192.168.1.7' } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/devices.csv',
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('krakenos-dispositivos.csv');
    expect(res.body).toMatch(/^mac,ip,hostname/);
    expect(res.body).toContain('aa:bb:cc:00:11:22');
  });

  it('exporta la auditoría como CSV (solo admin)', async () => {
    await app.prisma.auditLog.create({ data: { action: 'test.export', ip: '10.0.0.1' } });
    const adminToken = signAccess(
      app,
      await seedUser(app, { email: 'admin-csv@krakenos.test', role: 'admin' }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/audit.csv',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('test.export');
  });

  it('un viewer NO puede descargar la auditoría por CSV (403, coherente con /api/audit)', async () => {
    await app.prisma.auditLog.create({ data: { action: 'test.export', ip: '10.0.0.1' } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/audit.csv',
      headers: authHeader(token), // token de viewer del beforeEach
    });
    expect(res.statusCode).toBe(403);
  });

  it('exporta el tráfico como CSV (cabecera aun sin datos)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/traffic.csv?range=week',
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/^timestamp,rx_bytes_por_seg,tx_bytes_por_seg/);
  });
});
