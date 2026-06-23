import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashEmail } from '../../src/plugins/audit.js';
import { authHeader, buildTestApp, eventually, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas de auditoría', () => {
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

  it('un login queda reflejado en el audit log (admin lo consulta)', async () => {
    const admin = await seedUser(app, { email: 'adm@krakenos.test', password: 'password123', role: 'admin' });

    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'adm@krakenos.test', password: 'password123' },
    });

    await eventually(async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/audit',
        headers: authHeader(signAccess(app, admin)),
      });
      const actions = (res.json() as { action: string }[]).map((e) => e.action);
      expect(actions).toContain('auth.login');
    });
  });

  it('devuelve las entradas ordenadas por fecha descendente y respeta limit', async () => {
    const admin = await seedUser(app, { role: 'admin' });

    // Inserta varias entradas con timestamps crecientes y conocidos.
    for (let i = 0; i < 5; i++) {
      await app.prisma.auditLog.create({
        data: { action: `test.event.${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) },
      });
    }

    const token = signAccess(app, admin);

    const all = await app.inject({ method: 'GET', url: '/api/audit', headers: authHeader(token) });
    const entries = all.json() as { action: string; createdAt: string }[];
    expect(entries.length).toBeGreaterThanOrEqual(5);
    const times = entries.map((e) => Date.parse(e.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a)); // desc

    const limited = await app.inject({
      method: 'GET',
      url: '/api/audit?limit=2',
      headers: authHeader(token),
    });
    expect(limited.json()).toHaveLength(2);
  });

  it('sin token devuelve 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/audit' })).statusCode).toBe(401);
  });

  it('un login fallido audita el email HASHEADO, no en claro (US-85, F11)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'victima@krakenos.test', password: 'incorrecta' },
    });

    const row = await eventually(async () => {
      const r = await app.prisma.auditLog.findFirst({ where: { action: 'auth.login_failed' } });
      if (!r) throw new Error('aún sin escribir');
      return r;
    });
    expect(row.detail).toBe(hashEmail('victima@krakenos.test'));
    expect(row.detail).not.toContain('victima@krakenos.test'); // sin PII en claro
  });

  it('trunca audit.detail a 1 KB antes de persistir (US-58)', async () => {
    app.audit({ action: 'test.big', detail: 'x'.repeat(5000) });

    const row = await eventually(async () => {
      const r = await app.prisma.auditLog.findFirst({ where: { action: 'test.big' } });
      if (!r) throw new Error('aún sin escribir');
      return r;
    });
    expect(row.detail).toHaveLength(1024);
    expect(row.detail).toBe('x'.repeat(1024));
  });
});
