import type { Device, UserSummary } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeader,
  buildTestApp,
  refreshCookie,
  refreshCookieHeader,
  resetDb,
  seedUser,
  signAccess,
} from '../helpers/app.js';

/** Roles del hogar (US-179): member/kid/guest, caducidad de invitados y Device.ownerId. */
describe('roles del hogar (US-179)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    adminToken = signAccess(app, await seedUser(app, { role: 'admin' }));
  });

  async function tokenFor(role: 'member' | 'kid' | 'guest' | 'viewer'): Promise<string> {
    return signAccess(app, await seedUser(app, { email: `${role}@krakenos.test`, role }));
  }

  it('un member opera el hogar: toggle IoT, ejecutar escena y acción de grupo', async () => {
    const memberToken = await tokenFor('member');

    const toggle = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/light-salon',
      headers: authHeader(memberToken),
      payload: { on: false },
    });
    expect(toggle.statusCode).toBe(200);

    const scene = (await app
      .inject({
        method: 'POST',
        url: '/api/scenes',
        headers: authHeader(adminToken),
        payload: { name: 'Cine', actions: [{ deviceId: 'light-salon', on: false }] },
      })
      .then((r) => r.json())) as { id: string };
    const run = await app.inject({
      method: 'POST',
      url: `/api/scenes/${scene.id}/run`,
      headers: authHeader(memberToken),
    });
    expect(run.statusCode).toBe(200);

    const room = (await app
      .inject({
        method: 'POST',
        url: '/api/rooms',
        headers: authHeader(adminToken),
        payload: { name: 'Salón' },
      })
      .then((r) => r.json())) as { id: string };
    const action = await app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/action`,
      headers: authHeader(memberToken),
      payload: { on: true },
    });
    expect(action.statusCode).toBe(200);
  });

  it('un member NO gestiona red, usuarios ni escenas (solo las opera)', async () => {
    const memberToken = await tokenFor('member');
    const wifi = await app.inject({
      method: 'PUT',
      url: '/api/wifi',
      headers: authHeader(memberToken),
      payload: { ssid: 'Pwned' },
    });
    expect(wifi.statusCode).toBe(403);

    const users = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeader(memberToken),
      payload: { email: 'x@x.test', displayName: 'X', password: 'password123', role: 'admin' },
    });
    expect(users.statusCode).toBe(403);

    const scene = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      headers: authHeader(memberToken),
      payload: { name: 'X', actions: [] },
    });
    expect(scene.statusCode).toBe(403);
  });

  it('kid, guest y viewer no operan el hogar (403 en toggle/run/action)', async () => {
    for (const role of ['kid', 'guest', 'viewer'] as const) {
      const token = await tokenFor(role);
      const toggle = await app.inject({
        method: 'PATCH',
        url: '/api/iot/devices/light-salon',
        headers: authHeader(token),
        payload: { on: true },
      });
      expect(toggle.statusCode, role).toBe(403);
    }
  });

  it('el alta de usuarios acepta los roles nuevos y la caducidad de invitado', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: authHeader(adminToken),
      payload: {
        email: 'invitado@krakenos.test',
        displayName: 'Visita',
        password: 'password123',
        role: 'guest',
        expiresAt,
      },
    });
    expect(res.statusCode).toBe(201);
    const user = res.json() as UserSummary;
    expect(user.role).toBe('guest');
    expect(user.expiresAt).toBe(expiresAt);
  });

  it('un invitado caducado no puede iniciar sesión ni refrescar (US-179)', async () => {
    const guest = await seedUser(app, { email: 'g@krakenos.test', role: 'guest' });

    // Con acceso vigente inicia sesión y obtiene cookie de refresh.
    await app.prisma.user.update({
      where: { id: guest.id },
      data: { expiresAt: new Date(Date.now() + 60_000) },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: guest.email, password: guest.password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = refreshCookie(login);

    // Caduca → ni login ni refresh; el refresh además revoca lo vivo.
    await app.prisma.user.update({
      where: { id: guest.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const reLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: guest.email, password: guest.password },
    });
    expect(reLogin.statusCode).toBe(401);
    expect(reLogin.json()).toMatchObject({ code: 'AUTH_ACCOUNT_EXPIRED' });

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: refreshCookieHeader(cookie),
    });
    expect(refresh.statusCode).toBe(401);
    expect(await app.prisma.refreshToken.count({ where: { userId: guest.id, revoked: false } })).toBe(0);
  });

  it('el admin asigna y desasigna el dueño de un dispositivo (Device.ownerId)', async () => {
    const member = await seedUser(app, { email: 'm@krakenos.test', role: 'member' });
    const row = await app.prisma.device.create({ data: { mac: 'aa:bb:cc:dd:ee:10', ip: '10.0.0.9' } });

    const assign = await app.inject({
      method: 'PATCH',
      url: `/api/inventory/devices/${row.id}`,
      headers: authHeader(adminToken),
      payload: { ownerId: member.id },
    });
    expect(assign.statusCode).toBe(200);
    expect((assign.json() as Device).ownerId).toBe(member.id);

    const clear = await app.inject({
      method: 'PATCH',
      url: `/api/inventory/devices/${row.id}`,
      headers: authHeader(adminToken),
      payload: { ownerId: null },
    });
    expect((clear.json() as Device).ownerId).toBeNull();
  });

  it('asignar un dueño inexistente responde 400 tipado (no un 500 de FK)', async () => {
    const row = await app.prisma.device.create({ data: { mac: 'aa:bb:cc:dd:ee:11', ip: '10.0.0.10' } });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/inventory/devices/${row.id}`,
      headers: authHeader(adminToken),
      payload: { ownerId: 'no-existe' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'OWNER_NOT_FOUND' });
  });

  it('borrar al dueño deja el dispositivo sin dueño (SetNull), no huérfano roto', async () => {
    const member = await seedUser(app, { email: 'm2@krakenos.test', role: 'member' });
    const row = await app.prisma.device.create({
      data: { mac: 'aa:bb:cc:dd:ee:12', ip: '10.0.0.11', ownerId: member.id },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/users/${member.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
    expect((await app.prisma.device.findUnique({ where: { id: row.id } }))?.ownerId).toBeNull();
  });
});
