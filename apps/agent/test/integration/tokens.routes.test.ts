import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Cabecera Bearer con un token de API en claro. */
const tokenHeader = (token: string) => ({ authorization: `Bearer ${token}` });

async function createToken(
  app: FastifyInstance,
  sessionToken: string,
  scopes: string[],
  name = 'HA',
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    headers: authHeader(sessionToken),
    payload: { name, scopes },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

describe('tokens de API (US-174)', () => {
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

  it('crea un token y devuelve el valor en claro una vez; la lista lo omite', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const session = signAccess(app, admin);
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: authHeader(session),
      payload: { name: 'Home Assistant', scopes: ['home.view', 'home.control'] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^krt_/);
    expect(body.scopes).toEqual(['home.view', 'home.control']);
    expect(body.prefix).toBe(body.token.slice(0, 8));

    const list = await app.inject({ method: 'GET', url: '/api/tokens', headers: authHeader(session) });
    const items = list.json();
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('token'); // el claro no se repite
    expect(items[0]).not.toHaveProperty('tokenHash');
  });

  it('acota los scopes al rol: un viewer no puede conceder home.control', async () => {
    const viewer = await seedUser(app, { role: 'viewer' });
    const session = signAccess(app, viewer);
    // Pide ambos; solo conserva home.view.
    const ok = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: authHeader(session),
      payload: { name: 'lectura', scopes: ['home.view', 'home.control'] },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().scopes).toEqual(['home.view']);

    // Pide SOLO control → nada válido → 400.
    const bad = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: authHeader(session),
      payload: { name: 'x', scopes: ['home.control'] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('el token lee, y con home.control opera; sin él, 403', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const session = signAccess(app, admin);
    const readToken = await createToken(app, session, ['home.view'], 'solo-lectura');
    const ctrlToken = await createToken(app, session, ['home.view', 'home.control'], 'control');

    // Lectura autenticada: ambos leen.
    expect(
      (await app.inject({ method: 'GET', url: '/api/iot/devices', headers: tokenHeader(readToken) }))
        .statusCode,
    ).toBe(200);

    // home.control (PATCH iot): el de solo lectura → 403; el de control → NO 403 (404 por id inexistente).
    const denied = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/nope',
      headers: tokenHeader(readToken),
      payload: { on: true },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('AUTH_FORBIDDEN');

    const allowed = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/nope',
      headers: tokenHeader(ctrlToken),
      payload: { on: true },
    });
    expect(allowed.statusCode).not.toBe(403);
  });

  it('un token de API NUNCA administra (requireRole/requireActiveAdmin → 403)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const session = signAccess(app, admin);
    const token = await createToken(app, session, ['home.view', 'home.control']);

    // requireRole('admin'): PATCH ajustes del sistema.
    const settings = await app.inject({
      method: 'PATCH',
      url: '/api/system/settings',
      headers: tokenHeader(token),
      payload: { key: 'homeName', value: 'x' },
    });
    expect(settings.statusCode).toBe(403);
    expect(settings.json().code).toBe('API_TOKEN_FORBIDDEN');

    // requireActiveAdmin: backup.
    const backup = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: tokenHeader(token),
      payload: { passphrase: 'passphrase-123' },
    });
    expect(backup.statusCode).toBe(403);
    expect(backup.json().code).toBe('API_TOKEN_FORBIDDEN');
  });

  it('un token de API no gestiona tokens (autoservicio session-only)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const session = signAccess(app, admin);
    const token = await createToken(app, session, ['home.view']);
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: tokenHeader(token),
      payload: { name: 'anidado', scopes: ['home.view'] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('API_TOKEN_FORBIDDEN');
  });

  it('revocar el token lo invalida de inmediato (401)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const session = signAccess(app, admin);
    const token = await createToken(app, session, ['home.view']);
    const id = (await app.inject({ method: 'GET', url: '/api/tokens', headers: authHeader(session) })).json()[0].id;

    expect(
      (await app.inject({ method: 'GET', url: '/api/iot/devices', headers: tokenHeader(token) }))
        .statusCode,
    ).toBe(200);

    const del = await app.inject({ method: 'DELETE', url: `/api/tokens/${id}`, headers: authHeader(session) });
    expect(del.statusCode).toBe(204);

    // Ya no autentica.
    expect(
      (await app.inject({ method: 'GET', url: '/api/iot/devices', headers: tokenHeader(token) }))
        .statusCode,
    ).toBe(401);
  });

  it('un token de usuario deshabilitado deja de valer (401)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const session = signAccess(app, admin);
    const token = await createToken(app, session, ['home.view']);
    await app.prisma.user.update({ where: { id: admin.id }, data: { status: 'disabled' } });
    expect(
      (await app.inject({ method: 'GET', url: '/api/iot/devices', headers: tokenHeader(token) }))
        .statusCode,
    ).toBe(401);
  });

  // ---- Caducidad y revocación en cascada (AUD3-04, US-227) ----

  it('la caducidad del USUARIO corta el token, aunque el token no caduque', async () => {
    // Escenario real: una visita de fin de semana (`guest` con `expiresAt`) se crea
    // un token sin caducidad durante su estancia. Login/refresh/2FA sí miraban
    // `User.expiresAt`; el token de API no → acceso indefinido.
    const guest = await seedUser(app, { email: 'visita@krakenos.test', role: 'guest' });
    const token = await createToken(app, signAccess(app, guest), ['home.view']);

    expect(
      (await app.inject({ method: 'GET', url: '/api/iot/devices', headers: tokenHeader(token) }))
        .statusCode,
    ).toBe(200);

    await app.prisma.user.update({
      where: { id: guest.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect(
      (await app.inject({ method: 'GET', url: '/api/iot/devices', headers: tokenHeader(token) }))
        .statusCode,
    ).toBe(401);
  });

  it('deshabilitar, cambiar de rol o resetear la contraseña BORRA sus tokens', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const adminSession = signAccess(app, admin);

    for (const patch of [
      { status: 'disabled' as const },
      { role: 'viewer' as const },
    ]) {
      const target = await seedUser(app, {
        email: `t-${JSON.stringify(patch)}@krakenos.test`,
        role: 'member',
      });
      const token = await createToken(app, signAccess(app, target), ['home.view']);
      expect(await app.prisma.apiToken.count({ where: { userId: target.id } })).toBe(1);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/users/${target.id}`,
        headers: authHeader(adminSession),
        payload: patch,
      });
      expect(res.statusCode).toBe(200);

      expect(await app.prisma.apiToken.count({ where: { userId: target.id } })).toBe(0);
      expect(
        (await app.inject({ method: 'GET', url: '/api/iot/devices', headers: tokenHeader(token) }))
          .statusCode,
      ).toBe(401);
    }

    // Reseteo de contraseña: la sesión muere y la credencial de automatización también.
    const target = await seedUser(app, { email: 'reset@krakenos.test', role: 'member' });
    const token = await createToken(app, signAccess(app, target), ['home.view']);
    const reset = await app.inject({
      method: 'POST',
      url: `/api/users/${target.id}/password`,
      headers: authHeader(adminSession),
      payload: { password: 'nuevaClave123' },
    });
    expect(reset.statusCode).toBe(204);
    expect(await app.prisma.apiToken.count({ where: { userId: target.id } })).toBe(0);
    expect(
      (await app.inject({ method: 'GET', url: '/api/iot/devices', headers: tokenHeader(token) }))
        .statusCode,
    ).toBe(401);
  });

  it('el listado de usuarios enseña al admin cuántos tokens vivos tiene cada cuenta', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const session = signAccess(app, admin);
    const member = await seedUser(app, { email: 'con-tokens@krakenos.test', role: 'member' });
    await createToken(app, signAccess(app, member), ['home.view'], 'HA');
    await createToken(app, signAccess(app, member), ['home.control'], 'Node-RED');

    const res = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: authHeader(session),
    });
    expect(res.statusCode).toBe(200);
    const users = res.json() as { id: string; apiTokenCount?: number }[];
    expect(users.find((u) => u.id === member.id)?.apiTokenCount).toBe(2);
    expect(users.find((u) => u.id === admin.id)?.apiTokenCount).toBe(0);
  });

  it('un token de API no alcanza el vídeo de las cámaras (AUD3-02)', async () => {
    // `home.cameras` no es un scope de token: una credencial de automatización
    // (Home Assistant, Node-RED) no debe poder abrir el directo de la casa.
    const admin = await seedUser(app, { role: 'admin' });
    const token = await createToken(app, signAccess(app, admin), ['home.view', 'home.control']);

    for (const url of ['/api/cameras', '/api/cameras/recordings']) {
      const res = await app.inject({ method: 'GET', url, headers: tokenHeader(token) });
      expect(`${url} → ${res.statusCode}`).toBe(`${url} → 403`);
    }
  });
});
