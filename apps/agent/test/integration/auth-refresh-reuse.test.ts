import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  eventually,
  refreshCookie,
  refreshCookieHeader,
  resetDb,
  seedUser,
} from '../helpers/app.js';

const PASSWORD = 'password123';

// El refresh token vive en la cookie httpOnly (US-91); los helpers lo manejan como tal.
async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
  return refreshCookie(res);
}

function refresh(app: FastifyInstance, token: string) {
  return app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: refreshCookieHeader(token) });
}

function logout(app: FastifyInstance, token: string) {
  return app.inject({ method: 'POST', url: '/api/auth/logout', cookies: refreshCookieHeader(token) });
}

describe('detección de reuso de refresh (US-78, F4)', () => {
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

  it('reusar un token ROTADO revoca toda la familia y responde AUTH_REFRESH_REUSE', async () => {
    await seedUser(app, { email: 'reuse@krakenos.test', password: PASSWORD });
    const parent = await login(app, 'reuse@krakenos.test');

    // Rotación normal: el padre emite un hijo.
    const ok = await refresh(app, parent);
    expect(ok.statusCode).toBe(200);
    const child = refreshCookie(ok); // el hijo viene en la cookie rotada

    // Reuso del padre ya rotado → señal de robo.
    const reuse = await refresh(app, parent);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().code).toBe('AUTH_REFRESH_REUSE');

    // La familia entera queda revocada: el hijo legítimo tampoco sirve ya.
    const childAfter = await refresh(app, child);
    expect(childAfter.statusCode).toBe(401);
    expect(childAfter.json().code).toBe('AUTH_INVALID_TOKEN');
  });

  it('dos refresh CONCURRENTES con el mismo token NO emiten dos sesiones (cierra el TOCTOU)', async () => {
    await seedUser(app, { email: 'race@krakenos.test', password: PASSWORD });
    const parent = await login(app, 'race@krakenos.test');

    // Ambas peticiones leen el token como no-revocado, pero la rotación es atómica
    // (updateMany condicional): solo una puede pasar revoked:false→true. El
    // invariante de seguridad es que NUNCA salgan dos sesiones vivas del mismo
    // token — antes del fix, el TOCTOU dejaba que ambas devolvieran 200.
    // (Se afirma el invariante, no códigos exactos: dos escrituras concurrentes a
    // SQLite pueden dar un 5xx transitorio por lock, que tampoco es una sesión.)
    const [a, b] = await Promise.all([refresh(app, parent), refresh(app, parent)]);
    const successes = [a, b].filter((r) => r.statusCode === 200);
    expect(successes.length).toBeLessThanOrEqual(1); // jamás dos sesiones vivas

    // Si una ganó, la familia queda cerrada: reusar el padre original ya no sirve.
    const reuseParent = await refresh(app, parent);
    expect(reuseParent.statusCode).toBe(401);
  });

  it('el reuso registra el evento de seguridad auth.refresh_reuse', async () => {
    await seedUser(app, { email: 'audit-reuse@krakenos.test', password: PASSWORD });
    const parent = await login(app, 'audit-reuse@krakenos.test');
    await refresh(app, parent); // rota
    await refresh(app, parent); // reuso

    await eventually(async () => {
      const count = await app.prisma.auditLog.count({ where: { action: 'auth.refresh_reuse' } });
      expect(count).toBeGreaterThan(0);
    });
  });

  it('reusar un token revocado por LOGOUT no es reuso: rechazo simple, sin tocar otras sesiones', async () => {
    await seedUser(app, { email: 'logout@krakenos.test', password: PASSWORD });
    const sessionA = await login(app, 'logout@krakenos.test');
    const sessionB = await login(app, 'logout@krakenos.test');

    // Logout de A: revoca su token (sin rotarlo).
    expect((await logout(app, sessionA)).statusCode).toBe(204);

    // Reusar A → invalid token, NO refresh_reuse (no fue rotado).
    const reuseA = await refresh(app, sessionA);
    expect(reuseA.statusCode).toBe(401);
    expect(reuseA.json().code).toBe('AUTH_INVALID_TOKEN');

    // La otra sesión B sigue viva (no se revocó la familia por un logout).
    const okB = await refresh(app, sessionB);
    expect(okB.statusCode).toBe(200);
  });
});
