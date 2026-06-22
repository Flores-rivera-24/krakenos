import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rateLimitStore } from '../../src/plugins/rate-limit-store.js';
import { BackupCodeService } from '../../src/webauthn/backup-codes.service.js';
import { buildTestApp, resetDb, seedUser, signMfaPending } from '../helpers/app.js';

/**
 * Rate limiting y anti-replay en los endpoints PÚBLICOS sensibles de auth (US-88):
 * `/api/setup/init`, `/api/webauthn/authenticate/*` y `/api/webauthn/backup-codes/verify`.
 *
 * Se construye una app nueva por test para que el contador en memoria de
 * `@fastify/rate-limit` quede aislado. El límite de los endpoints de 2FA comparte
 * el `rateLimitStore` del login: se baja a 3 para que el test sea rápido y determinista.
 */
describe('rate-limit y anti-replay en endpoints públicos de auth (US-88)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp({ routes: true, rateLimit: true });
    await resetDb(app);
    rateLimitStore.update(3);
  });

  afterEach(async () => {
    rateLimitStore.reset();
    await app.close();
  });

  // ---- /setup/init ----

  it('throttlea /setup/init tras 5 intentos por IP (abuso del primer admin)', async () => {
    const body = {
      homeName: 'Hogar',
      email: 'owner@krakenos.test',
      displayName: 'Dueño',
      password: 'password123',
    };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/setup/init', payload: body });
      statuses.push(res.statusCode);
    }
    // 1º crea el admin (200), 2º-5º ya configurado (409), 6º bloqueado por rate-limit.
    expect(statuses[0]).toBe(200);
    expect(statuses[5]).toBe(429);
    // El throttling no creó admins de más.
    expect(await app.prisma.user.count()).toBe(1);
  });

  // ---- /webauthn/authenticate/options ----

  it('throttlea /authenticate/options en el (N+1)º intento por IP', async () => {
    const user = await seedUser(app, { email: 'opt@krakenos.test' });
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/webauthn/authenticate/options',
        payload: { email: 'opt@krakenos.test', mfaToken: signMfaPending(app, user.id) },
      });

    const allowed = [await attempt(), await attempt(), await attempt()];
    expect(allowed.every((r) => r.statusCode === 200)).toBe(true);
    expect((await attempt()).statusCode).toBe(429);
  });

  // ---- mfaToken de un solo uso (anti-replay) ----

  it('rechaza el replay del mismo mfaToken en /authenticate/verify (un solo uso)', async () => {
    const user = await seedUser(app, { email: 'rp@krakenos.test' });
    const token = signMfaPending(app, user.id);

    // 1er uso: pasa el gate del primer factor; falla la ceremonia WebAuthn (sin challenge).
    const first = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/verify',
      payload: { email: 'rp@krakenos.test', mfaToken: token, response: { id: 'x' } },
    });
    expect(first.statusCode).toBe(401);
    expect(first.json().code).toBe('WEBAUTHN_ERROR');

    // 2º uso del MISMO token (replay) → rechazado por el gate, ya no por WebAuthn.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/webauthn/authenticate/verify',
      payload: { email: 'rp@krakenos.test', mfaToken: token, response: { id: 'x' } },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('AUTH_INVALID_TOKEN');
  });

  // ---- /webauthn/backup-codes/verify ----

  it('rechaza el replay del mfaToken en backup-codes/verify aunque el código sea válido', async () => {
    const user = await seedUser(app, { email: 'rpc@krakenos.test' });
    const codes = await new BackupCodeService(app.prisma).generate(user.id);
    const token = signMfaPending(app, user.id);

    // 1er uso del token con un código erróneo: consume el token (un solo uso).
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/webauthn/backup-codes/verify',
      payload: { email: 'rpc@krakenos.test', mfaToken: token, code: 'no-existe' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('WEBAUTHN_ERROR');

    // Replay del MISMO token, ahora con un código VÁLIDO → rechazado por token usado.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/webauthn/backup-codes/verify',
      payload: { email: 'rpc@krakenos.test', mfaToken: token, code: codes[0]! },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('AUTH_INVALID_TOKEN');
    // No se emitió sesión: un token capturado no se puede reutilizar ni con código bueno.
    expect(await app.prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('un código de recuperación no es re-consumible (token fresco, código ya usado)', async () => {
    const user = await seedUser(app, { email: 'cc@krakenos.test' });
    const codes = await new BackupCodeService(app.prisma).generate(user.id);
    const code = codes[0]!;

    const ok = await app.inject({
      method: 'POST',
      url: '/api/webauthn/backup-codes/verify',
      payload: { email: 'cc@krakenos.test', mfaToken: signMfaPending(app, user.id), code },
    });
    expect(ok.statusCode).toBe(200);

    // Mismo código con un mfaToken NUEVO (válido) → rechazado: el código ya se gastó.
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/webauthn/backup-codes/verify',
      payload: { email: 'cc@krakenos.test', mfaToken: signMfaPending(app, user.id), code },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().code).toBe('WEBAUTHN_ERROR');
  });

  it('throttlea la fuerza bruta de códigos en backup-codes/verify (N+1)º intento', async () => {
    const user = await seedUser(app, { email: 'bf@krakenos.test' });
    await new BackupCodeService(app.prisma).generate(user.id);
    const guess = () =>
      app.inject({
        method: 'POST',
        url: '/api/webauthn/backup-codes/verify',
        // Token fresco por intento (un solo uso) + código erróneo: simula fuerza bruta.
        payload: { email: 'bf@krakenos.test', mfaToken: signMfaPending(app, user.id), code: 'xxxx-xxxx-xxxx' },
      });

    const allowed = [await guess(), await guess(), await guess()];
    expect(allowed.every((r) => r.statusCode === 401)).toBe(true);
    expect((await guess()).statusCode).toBe(429);
  });
});
