import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupToken } from '../../src/modules/setup/setup-token.js';
import { authHeader, buildTestApp, eventually, resetDb } from '../helpers/app.js';

const baseBody = {
  homeName: 'Hogar Kraken',
  email: 'owner@krakenos.test',
  displayName: 'Dueño',
  password: 'password123',
};

/** Cuerpo de /init con el token de configuración vigente (si hay uno activo). */
function initBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return setupToken.isActive()
    ? { ...baseBody, setupToken: setupToken.ensure(), ...extra }
    : { ...baseBody, ...extra };
}

describe('rutas de setup', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    setupToken.reset();
  });

  it('status pasa de needsSetup:true a false tras inicializar', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(before.json()).toEqual({ needsSetup: true, requiresToken: false });

    await app.inject({ method: 'POST', url: '/api/setup/init', payload: initBody() });

    const after = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(after.json()).toEqual({ needsSetup: false, requiresToken: false });
  });

  it('init crea admin, persiste homeName, audita y emite tokens usables', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/setup/init', payload: initBody() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: { id: string; role: string }; tokens: { accessToken: string } };
    expect(body.user.role).toBe('admin');

    // homeName quedó persistido como Setting.
    const setting = await app.prisma.setting.findUnique({ where: { key: 'homeName' } });
    expect(setting?.value).toBe('Hogar Kraken');

    // Acción auditada.
    await eventually(async () => {
      const entry = await app.prisma.auditLog.findFirst({ where: { action: 'setup.init' } });
      expect(entry?.userId).toBe(body.user.id);
    });

    // El access token devuelto sirve para una ruta protegida.
    const status = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      headers: authHeader(body.tokens.accessToken),
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().id).toBe(body.user.id);
  });

  it('init responde 409 si ya hay un usuario', async () => {
    await app.inject({ method: 'POST', url: '/api/setup/init', payload: initBody() });
    const second = await app.inject({ method: 'POST', url: '/api/setup/init', payload: initBody() });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('SETUP_ALREADY_DONE');
  });

  it('dos init concurrentes crean exactamente un admin y devuelven un 409 (US-53)', async () => {
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/setup/init', payload: initBody() }),
      // Segundo correo distinto: aun así no debe poder crearse un segundo admin.
      app.inject({
        method: 'POST',
        url: '/api/setup/init',
        payload: initBody({ email: 'otro@krakenos.test' }),
      }),
    ]);

    // Exactamente uno gana (200) y el otro recibe 409 determinista.
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const conflict = a.statusCode === 409 ? a : b;
    expect(conflict.json().code).toBe('SETUP_ALREADY_DONE');

    // No quedó un segundo admin ni un homeName a medias.
    expect(await app.prisma.user.count()).toBe(1);
    const settings = await app.prisma.setting.findMany({ where: { key: 'homeName' } });
    expect(settings).toHaveLength(1);
  });

  it('400 con payload incompleto o contraseña corta', async () => {
    const short = await app.inject({
      method: 'POST',
      url: '/api/setup/init',
      payload: initBody({ password: '123' }),
    });
    expect(short.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/setup/init',
      payload: { email: 'x@krakenos.test' },
    });
    expect(missing.statusCode).toBe(400);
  });

  // ---- Token de configuración out-of-band (US-81, F10) ----

  it('con token activo, status indica requiresToken:true', async () => {
    setupToken.ensure();
    const res = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(res.json()).toEqual({ needsSetup: true, requiresToken: true });
  });

  it('con token activo, /init sin token o con token erróneo → 401', async () => {
    setupToken.ensure();

    const noToken = await app.inject({ method: 'POST', url: '/api/setup/init', payload: baseBody });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.json().code).toBe('SETUP_TOKEN_INVALID');

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/setup/init',
      payload: { ...baseBody, setupToken: 'no-es-el-token' },
    });
    expect(wrong.statusCode).toBe(401);

    // No se creó ningún admin.
    expect(await app.prisma.user.count()).toBe(0);
  });

  it('con token activo, /init con el token correcto crea el admin e invalida el token', async () => {
    const token = setupToken.ensure();

    const ok = await app.inject({
      method: 'POST',
      url: '/api/setup/init',
      payload: { ...baseBody, setupToken: token },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.role).toBe('admin');

    // El token quedó invalidado tras el éxito (de un solo uso).
    expect(setupToken.isActive()).toBe(false);
  });
});
