import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, eventually, resetDb, seedUser } from '../helpers/app.js';

const PASSWORD = 'password123';

async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
  return (res.json() as { tokens: { refreshToken: string } }).tokens.refreshToken;
}

function refresh(app: FastifyInstance, refreshToken: string) {
  return app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } });
}

function logout(app: FastifyInstance, refreshToken: string) {
  return app.inject({ method: 'POST', url: '/api/auth/logout', payload: { refreshToken } });
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
    const child = (ok.json() as { refreshToken: string }).refreshToken;

    // Reuso del padre ya rotado → señal de robo.
    const reuse = await refresh(app, parent);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().code).toBe('AUTH_REFRESH_REUSE');

    // La familia entera queda revocada: el hijo legítimo tampoco sirve ya.
    const childAfter = await refresh(app, child);
    expect(childAfter.statusCode).toBe(401);
    expect(childAfter.json().code).toBe('AUTH_INVALID_TOKEN');
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
