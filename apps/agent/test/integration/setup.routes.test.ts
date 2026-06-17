import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, eventually, resetDb } from '../helpers/app.js';

const initBody = {
  homeName: 'Hogar Kraken',
  email: 'owner@krakenos.test',
  displayName: 'Dueño',
  password: 'password123',
};

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
  });

  it('status pasa de needsSetup:true a false tras inicializar', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(before.json()).toEqual({ needsSetup: true });

    await app.inject({ method: 'POST', url: '/api/setup/init', payload: initBody });

    const after = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(after.json()).toEqual({ needsSetup: false });
  });

  it('init crea admin, persiste homeName, audita y emite tokens usables', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/setup/init', payload: initBody });
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
    await app.inject({ method: 'POST', url: '/api/setup/init', payload: initBody });
    const second = await app.inject({ method: 'POST', url: '/api/setup/init', payload: initBody });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('SETUP_ALREADY_DONE');
  });

  it('400 con payload incompleto o contraseña corta', async () => {
    const short = await app.inject({
      method: 'POST',
      url: '/api/setup/init',
      payload: { ...initBody, password: '123' },
    });
    expect(short.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/setup/init',
      payload: { email: 'x@krakenos.test' },
    });
    expect(missing.statusCode).toBe(400);
  });
});
