import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas HTTP (integración)', () => {
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

  describe('setup', () => {
    it('status indica needsSetup cuando no hay usuarios', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ needsSetup: true, requiresToken: false });
    });

    it('init crea el admin y luego responde 409', async () => {
      const body = {
        homeName: 'Casa Test',
        email: 'admin@krakenos.test',
        displayName: 'Admin',
        password: 'password123',
      };
      const first = await app.inject({ method: 'POST', url: '/api/setup/init', payload: body });
      expect(first.statusCode).toBe(200);
      expect(first.json().user.role).toBe('admin');
      expect(first.json().tokens.accessToken).toBeTruthy();

      const second = await app.inject({ method: 'POST', url: '/api/setup/init', payload: body });
      expect(second.statusCode).toBe(409);
      expect(second.json().code).toBe('SETUP_ALREADY_DONE');
    });
  });

  describe('auth/login', () => {
    it('200 con credenciales válidas', async () => {
      await seedUser(app, { email: 'a@krakenos.test', password: 'password123' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'a@krakenos.test', password: 'password123' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().tokens.accessToken).toBeTruthy();
    });

    it('401 con contraseña incorrecta', async () => {
      await seedUser(app, { email: 'a@krakenos.test', password: 'password123' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'a@krakenos.test', password: 'malísima' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('400 si el email no es válido (validación de schema)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'no-es-email', password: 'password123' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('guard de autenticación', () => {
    it('401 sin token en /api/inventory/devices', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/inventory/devices' });
      expect(res.statusCode).toBe(401);
    });

    it('200 con access token válido', async () => {
      const user = await seedUser(app, { role: 'viewer' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/inventory/devices',
        headers: authHeader(signAccess(app, user)),
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    it('rescan devuelve los dispositivos del driver mock', async () => {
      const user = await seedUser(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/inventory/rescan',
        headers: authHeader(signAccess(app, user)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(5);
    });
  });

  describe('autorización por rol (wifi)', () => {
    it('viewer puede leer pero no escribir', async () => {
      const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
      const token = signAccess(app, viewer);

      const read = await app.inject({
        method: 'GET',
        url: '/api/wifi',
        headers: authHeader(token),
      });
      expect(read.statusCode).toBe(200);

      const write = await app.inject({
        method: 'PUT',
        url: '/api/wifi',
        headers: authHeader(token),
        payload: { ssid: 'Hackeada' },
      });
      expect(write.statusCode).toBe(403);
      expect(write.json().code).toBe('AUTH_FORBIDDEN');
    });

    it('admin puede escribir y la respuesta no incluye la contraseña', async () => {
      const admin = await seedUser(app, { email: 'adm@krakenos.test', role: 'admin' });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/wifi',
        headers: authHeader(signAccess(app, admin)),
        payload: { ssid: 'RedNueva', password: 'secretísima' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ssid).toBe('RedNueva');
      expect(res.json()).not.toHaveProperty('password');
    });
  });

  describe('system/stats', () => {
    it('200 con token y devuelve stats del servidor', async () => {
      const user = await seedUser(app);
      const res = await app.inject({
        method: 'GET',
        url: '/api/system/stats',
        headers: authHeader(signAccess(app, user)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('uptimeSeconds');
      expect(res.json()).toHaveProperty('cpu');
      expect(res.json()).toHaveProperty('memory');
    });
  });

  describe('audit (solo admin)', () => {
    it('viewer recibe 403', async () => {
      const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/audit',
        headers: authHeader(signAccess(app, viewer)),
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin recibe la lista', async () => {
      const admin = await seedUser(app, { email: 'adm@krakenos.test', role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/audit',
        headers: authHeader(signAccess(app, admin)),
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });
  });
});
