import type { User } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Modo sencillo / avanzado (US-176): preferencia por usuario, solo presentación. */
describe('modo de interfaz (US-176)', () => {
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

  it('el login incluye uiMode (default advanced) en el usuario', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: admin.email, password: admin.password },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { user: User }).user.uiMode).toBe('advanced');
  });

  it('PATCH /api/auth/ui-mode cambia el modo propio y persiste', async () => {
    const member = await seedUser(app, { email: 'm@krakenos.test', role: 'member' });
    const token = signAccess(app, member);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/ui-mode',
      headers: authHeader(token),
      payload: { uiMode: 'simple' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as User).uiMode).toBe('simple');
    expect((await app.prisma.user.findUnique({ where: { id: member.id } }))?.uiMode).toBe('simple');
  });

  it('rechaza un modo desconocido (400) y exige token (401)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/auth/ui-mode',
      headers: authHeader(signAccess(app, admin)),
      payload: { uiMode: 'hacker' },
    });
    expect(bad.statusCode).toBe(400);

    const anon = await app.inject({
      method: 'PATCH',
      url: '/api/auth/ui-mode',
      payload: { uiMode: 'simple' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('kid y guest se crean en modo sencillo; member/viewer en avanzado', async () => {
    const adminToken = signAccess(app, await seedUser(app, { role: 'admin' }));
    for (const [role, expected] of [
      ['kid', 'simple'],
      ['guest', 'simple'],
      ['member', 'advanced'],
      ['viewer', 'advanced'],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/users',
        headers: authHeader(adminToken),
        payload: {
          email: `${role}-ui@krakenos.test`,
          displayName: role,
          password: 'password123',
          role,
        },
      });
      expect(res.statusCode, role).toBe(201);
      const row = await app.prisma.user.findUnique({
        where: { email: `${role}-ui@krakenos.test` },
      });
      expect(row?.uiMode, role).toBe(expected);
    }
  });

  it('el modo NO altera permisos: un member en simple sigue sin gestionar la red', async () => {
    const member = await seedUser(app, { email: 'm2@krakenos.test', role: 'member' });
    await app.prisma.user.update({ where: { id: member.id }, data: { uiMode: 'simple' } });
    const token = signAccess(app, member);

    // Sigue operando el hogar (home.control)…
    const toggle = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/light-salon',
      headers: authHeader(token),
      payload: { on: true },
    });
    expect(toggle.statusCode).toBe(200);

    // …y sigue sin poder escribir en la red (la authz no depende del modo).
    const wifi = await app.inject({
      method: 'PUT',
      url: '/api/wifi',
      headers: authHeader(token),
      payload: { ssid: 'X' },
    });
    expect(wifi.statusCode).toBe(403);
  });
});
