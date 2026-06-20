import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas de push (US-45)', () => {
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

  const SUB = {
    endpoint: 'https://push.example/aaa',
    keys: { p256dh: 'pkey', auth: 'akey' },
  };

  it('GET /api/push/vapid-public-key devuelve la clave pública', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/push/vapid-public-key',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().publicKey).toBe('string');
    expect(res.json().publicKey.length).toBeGreaterThan(0);
  });

  it('POST /api/push/subscribe guarda la suscripción del usuario actual', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: authHeader(signAccess(app, user)),
      payload: SUB,
    });
    expect(res.statusCode).toBe(204);
    const row = await app.prisma.pushSubscription.findUnique({ where: { endpoint: SUB.endpoint } });
    expect(row?.userId).toBe(user.id);
    expect(row?.p256dh).toBe('pkey');
  });

  it('POST /api/push/subscribe hace upsert si el endpoint ya existe', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const headers = authHeader(signAccess(app, user));
    await app.inject({ method: 'POST', url: '/api/push/subscribe', headers, payload: SUB });
    await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers,
      payload: { ...SUB, keys: { p256dh: 'nuevo', auth: 'nuevo2' } },
    });

    const rows = await app.prisma.pushSubscription.findMany({ where: { endpoint: SUB.endpoint } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe('nuevo');
  });

  it('DELETE /api/push/subscribe elimina la suscripción del usuario actual', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const headers = authHeader(signAccess(app, user));
    await app.inject({ method: 'POST', url: '/api/push/subscribe', headers, payload: SUB });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/push/subscribe',
      headers,
      payload: { endpoint: SUB.endpoint },
    });
    expect(res.statusCode).toBe(204);
    const count = await app.prisma.pushSubscription.count({ where: { endpoint: SUB.endpoint } });
    expect(count).toBe(0);
  });
});
