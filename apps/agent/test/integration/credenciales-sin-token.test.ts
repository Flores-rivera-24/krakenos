import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * Un token de API NUNCA toca credenciales ni sesiones: con él, un admin (o un
 * `home.view` robado) podría generar códigos de recuperación y canjearlos en
 * `/api/auth/recover` por una sesión completa.
 */
describe('credenciales y sesiones exigen una sesión, no un token de API', () => {
  let app: FastifyInstance;
  let sessionToken: string;
  let apiToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    const admin = await seedUser(app, { role: 'admin', email: 'cred@krakenos.test' });
    sessionToken = signAccess(app, admin);
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: authHeader(sessionToken),
      payload: { name: 'HA', scopes: ['home.view'] },
    });
    expect(res.statusCode).toBe(201);
    apiToken = res.json().token as string;
  });

  const conToken = () => ({ authorization: `Bearer ${apiToken}` });

  const RUTAS: Array<[string, string, string, object | undefined]> = [
    ['POST', '/api/webauthn/backup-codes', 'genera códigos', undefined],
    ['POST', '/api/webauthn/register/options', 'registra passkey (opciones)', undefined],
    [
      'POST',
      '/api/webauthn/register/verify',
      'registra passkey (verifica)',
      { response: {}, name: 'x' },
    ],
    ['GET', '/api/webauthn/backup-codes', 'cuenta códigos', undefined],
    ['GET', '/api/webauthn/credentials', 'lista passkeys', undefined],
    [
      'POST',
      '/api/push/subscribe',
      'suscribe push',
      { endpoint: 'https://push.example/tok', keys: { p256dh: 'pkey', auth: 'akey' } },
    ],
    ['DELETE', '/api/push/subscribe', 'quita push', { endpoint: 'https://push.example/tok' }],
    ['PATCH', '/api/webauthn/credentials/abc', 'renombra passkey', { name: 'x' }],
    ['DELETE', '/api/webauthn/credentials/abc', 'borra passkey', undefined],
    ['GET', '/api/auth/sessions', 'lista sesiones', undefined],
    ['DELETE', '/api/auth/sessions/abc', 'revoca una sesión', undefined],
    ['DELETE', '/api/auth/sessions', 'revoca las demás sesiones', undefined],
    [
      'POST',
      '/api/auth/change-password',
      'cambia la contraseña',
      { currentPassword: 'no-es-un-secreto-actual', newPassword: 'no-es-un-secreto-nueva' },
    ],
  ];

  it.each(RUTAS)(
    '%s %s (%s) con token de API -> 403 API_TOKEN_FORBIDDEN',
    async (method, url, _d, payload) => {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: conToken(),
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('API_TOKEN_FORBIDDEN');
    },
  );

  it('cadena: con token no se pueden generar códigos para canjearlos en /recover', async () => {
    const gen = await app.inject({
      method: 'POST',
      url: '/api/webauthn/backup-codes',
      headers: conToken(),
    });
    expect(gen.statusCode).toBe(403);
    expect(gen.json().codes).toBeUndefined();

    // Con la SESIÓN sí hay códigos vigentes; con el token siguen sin poder obtenerse.
    const real = await app.inject({
      method: 'POST',
      url: '/api/webauthn/backup-codes',
      headers: authHeader(sessionToken),
    });
    expect((real.json().codes as string[]).length).toBeGreaterThan(0);
    const otra = await app.inject({
      method: 'POST',
      url: '/api/webauthn/backup-codes',
      headers: conToken(),
    });
    expect(otra.statusCode).toBe(403);
    expect(otra.json().codes).toBeUndefined();

    const rec = await app.inject({
      method: 'POST',
      url: '/api/auth/recover',
      payload: { email: 'cred@krakenos.test', code: 'aaaa-bbbb-cccc' },
    });
    expect(rec.statusCode).not.toBe(200);
  });

  it('regresión: con sesión normal se generan códigos y se listan sesiones', async () => {
    const gen = await app.inject({
      method: 'POST',
      url: '/api/webauthn/backup-codes',
      headers: authHeader(sessionToken),
    });
    expect(gen.statusCode).toBe(200);
    expect((gen.json().codes as string[]).length).toBeGreaterThan(0);

    const ses = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: authHeader(sessionToken),
    });
    expect(ses.statusCode).toBe(200);
  });

  it('regresión: con sesión normal se suscribe a push y se cuenta los códigos', async () => {
    const sub = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: authHeader(sessionToken),
      payload: { endpoint: 'https://push.example/sesion', keys: { p256dh: 'pkey', auth: 'akey' } },
    });
    expect(sub.statusCode).toBe(204);
    const cnt = await app.inject({
      method: 'GET',
      url: '/api/webauthn/backup-codes',
      headers: authHeader(sessionToken),
    });
    expect(cnt.statusCode).toBe(200);
  });
});
