import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Gestión de usuarios (US-101): CRUD, invariantes y ciclo de vida de la cuenta. */
describe('gestión de usuarios (US-101)', () => {
  let app: FastifyInstance;
  let adminId: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const admin = await seedUser(app, { email: 'admin@krakenos.test', role: 'admin' });
    adminId = admin.id;
    adminToken = signAccess(app, admin);
  });

  const create = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/users', headers: authHeader(adminToken), payload: body });

  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });

  it('lista usuarios sin exponer el hash de contraseña', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users', headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: 'admin@krakenos.test', role: 'admin', status: 'active' });
    expect(list[0]).not.toHaveProperty('passwordHash');
  });

  it('el admin da de alta un usuario que luego puede iniciar sesión', async () => {
    const res = await create({
      email: 'hija@krakenos.test',
      displayName: 'Hija',
      password: 'claveSegura1',
      role: 'viewer',
    });
    expect(res.statusCode).toBe(201);
    const user = res.json() as { id: string; status: string; lastLoginAt: null };
    expect(user.status).toBe('active');
    expect(user.lastLoginAt).toBeNull();

    const ok = await login('hija@krakenos.test', 'claveSegura1');
    expect(ok.statusCode).toBe(200);
  });

  it('rechaza email duplicado con 409 USER_EMAIL_TAKEN', async () => {
    const dup = await create({
      email: 'admin@krakenos.test',
      displayName: 'Otro',
      password: 'claveSegura1',
      role: 'viewer',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ code: 'USER_EMAIL_TAKEN' });
  });

  it('protege el invariante de "al menos un admin activo"', async () => {
    // Único admin: no se puede degradar…
    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/users/${adminId}`,
      headers: authHeader(adminToken),
      payload: { role: 'viewer' },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json()).toMatchObject({ code: 'LAST_ADMIN' });

    // …ni deshabilitar.
    const disable = await app.inject({
      method: 'PATCH',
      url: `/api/users/${adminId}`,
      headers: authHeader(adminToken),
      payload: { status: 'disabled' },
    });
    expect(disable.statusCode).toBe(409);
  });

  it('permite degradar a un admin cuando queda otro admin activo', async () => {
    const second = (await create({
      email: 'admin2@krakenos.test',
      displayName: 'Admin 2',
      password: 'claveSegura1',
      role: 'admin',
    }).then((r) => r.json())) as { id: string };

    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/users/${second.id}`,
      headers: authHeader(adminToken),
      payload: { role: 'viewer' },
    });
    expect(demote.statusCode).toBe(200);
    expect(demote.json()).toMatchObject({ role: 'viewer' });
  });

  it('un usuario deshabilitado no puede iniciar sesión', async () => {
    const user = (await create({
      email: 'expuesto@krakenos.test',
      displayName: 'Ex',
      password: 'claveSegura1',
      role: 'viewer',
    }).then((r) => r.json())) as { id: string };

    await app.inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      headers: authHeader(adminToken),
      payload: { status: 'disabled' },
    });

    const res = await login('expuesto@krakenos.test', 'claveSegura1');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'AUTH_ACCOUNT_DISABLED' });
  });

  it('el admin no puede eliminar su propia cuenta', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${adminId}`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'CANNOT_DELETE_SELF' });
  });

  it('el admin elimina a otro usuario', async () => {
    const user = (await create({
      email: 'temporal@krakenos.test',
      displayName: 'Temp',
      password: 'claveSegura1',
      role: 'viewer',
    }).then((r) => r.json())) as { id: string };

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/users/${user.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);

    const list = (await app
      .inject({ method: 'GET', url: '/api/users', headers: authHeader(adminToken) })
      .then((r) => r.json())) as unknown[];
    expect(list).toHaveLength(1);
  });

  it('borrar un usuario elimina sus suscripciones push en cascada (US-198)', async () => {
    const user = (await create({
      email: 'con-push@krakenos.test',
      displayName: 'Con Push',
      password: 'claveSegura1',
      role: 'viewer',
    }).then((r) => r.json())) as { id: string };
    await app.prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: 'https://push.example/ep-1',
        p256dh: 'clave',
        auth: 'auth',
      },
    });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/users/${user.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
    expect(await app.prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
  });

  it('el admin resetea la contraseña de un usuario', async () => {
    const user = (await create({
      email: 'olvidadiza@krakenos.test',
      displayName: 'Olvi',
      password: 'claveSegura1',
      role: 'viewer',
    }).then((r) => r.json())) as { id: string };

    const reset = await app.inject({
      method: 'POST',
      url: `/api/users/${user.id}/password`,
      headers: authHeader(adminToken),
      payload: { password: 'claveNueva9' },
    });
    expect(reset.statusCode).toBe(204);

    expect((await login('olvidadiza@krakenos.test', 'claveSegura1')).statusCode).toBe(401);
    expect((await login('olvidadiza@krakenos.test', 'claveNueva9')).statusCode).toBe(200);
  });

  it('un usuario cambia su propia contraseña con la actual correcta', async () => {
    const user = (await create({
      email: 'cambia@krakenos.test',
      displayName: 'Cambia',
      password: 'claveSegura1',
      role: 'viewer',
    }).then((r) => r.json())) as { id: string };
    const token = signAccess(app, { id: user.id, email: 'cambia@krakenos.test', role: 'viewer' });

    // Contraseña actual incorrecta → 400 (no es un fallo de sesión).
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeader(token),
      payload: { currentPassword: 'noEsLaActual', newPassword: 'otraClave22' },
    });
    expect(wrong.statusCode).toBe(400);

    // Correcta → 204 y la nueva contraseña funciona.
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: authHeader(token),
      payload: { currentPassword: 'claveSegura1', newPassword: 'otraClave22' },
    });
    expect(ok.statusCode).toBe(204);
    expect((await login('cambia@krakenos.test', 'otraClave22')).statusCode).toBe(200);
  });
});
