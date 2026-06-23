import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FAILURE_THRESHOLD, loginLockout } from '../../src/auth/login-lockout.js';
import { rateLimitStore } from '../../src/plugins/rate-limit-store.js';
import { buildTestApp, eventually, resetDb, seedUser } from '../helpers/app.js';

const PASSWORD = 'password123';

function attempt(app: FastifyInstance, email: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
}

describe('lockout por cuenta en login (US-77, F3)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    loginLockout.reset();
    // Límite por IP alto: aísla el lockout por cuenta del rate limit por IP.
    rateLimitStore.update(1000);
  });

  it('bloquea la cuenta (429 + Retry-After) tras alcanzar el umbral de fallos', async () => {
    await seedUser(app, { email: 'lock@krakenos.test', password: PASSWORD });

    // Fallos hasta (incluido) el umbral: todos responden 401.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      const res = await attempt(app, 'lock@krakenos.test', 'wrong-pass');
      expect(res.statusCode).toBe(401);
    }

    // El siguiente intento —incluso con la contraseña correcta— está bloqueado.
    const locked = await attempt(app, 'lock@krakenos.test', PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('AUTH_ACCOUNT_LOCKED');
    expect(locked.json().retryAfter).toBeGreaterThan(0);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('un login correcto antes del umbral limpia el contador', async () => {
    await seedUser(app, { email: 'reset@krakenos.test', password: PASSWORD });

    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      expect((await attempt(app, 'reset@krakenos.test', 'wrong-pass')).statusCode).toBe(401);
    }
    // Aún no bloqueado: login correcto pasa y resetea.
    expect((await attempt(app, 'reset@krakenos.test', PASSWORD)).statusCode).toBe(200);

    // Tras el reset, un nuevo fallo no bloquea de inmediato (cuenta desde cero).
    expect((await attempt(app, 'reset@krakenos.test', 'wrong-pass')).statusCode).toBe(401);
  });

  it('bloquea también un email inexistente (no enumera cuentas)', async () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      expect((await attempt(app, 'ghost@krakenos.test', 'wrong-pass')).statusCode).toBe(401);
    }
    const locked = await attempt(app, 'ghost@krakenos.test', 'whatever12');
    expect(locked.statusCode).toBe(429);
  });

  it('audita el bloqueo (auth.login_locked)', async () => {
    await seedUser(app, { email: 'audit@krakenos.test', password: PASSWORD });
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await attempt(app, 'audit@krakenos.test', 'wrong-pass');
    }
    await eventually(async () => {
      const count = await app.prisma.auditLog.count({ where: { action: 'auth.login_locked' } });
      expect(count).toBeGreaterThan(0);
    });
  });
});
