import type { User } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Idioma de la interfaz (US-177): preferencia por usuario, solo presentación. */
describe('idioma de interfaz (US-177)', () => {
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

  it('el login incluye locale (default es) en el usuario', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: admin.email, password: admin.password },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { user: User }).user.locale).toBe('es');
  });

  it('PATCH /api/auth/locale cambia el idioma propio y persiste', async () => {
    const member = await seedUser(app, { email: 'm@krakenos.test', role: 'member' });
    const token = signAccess(app, member);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/locale',
      headers: authHeader(token),
      payload: { locale: 'en' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as User).locale).toBe('en');
    expect((await app.prisma.user.findUnique({ where: { id: member.id } }))?.locale).toBe('en');
  });

  it('rechaza un idioma desconocido (400) y exige token (401)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/auth/locale',
      headers: authHeader(signAccess(app, admin)),
      payload: { locale: 'fr' },
    });
    expect(bad.statusCode).toBe(400);

    const anon = await app.inject({
      method: 'PATCH',
      url: '/api/auth/locale',
      payload: { locale: 'en' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('el idioma NO altera permisos: un viewer en inglés sigue sin escribir en la red', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    await app.prisma.user.update({ where: { id: viewer.id }, data: { locale: 'en' } });
    const token = signAccess(app, viewer);

    const wifi = await app.inject({
      method: 'PUT',
      url: '/api/wifi',
      headers: authHeader(token),
      payload: { ssid: 'X' },
    });
    expect(wifi.statusCode).toBe(403);
  });
});
